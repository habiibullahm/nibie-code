import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  completeActionRun,
  insertActionRun,
  sanitizeActionInputSummary,
} from "@/lib/actions/audit";
import { evaluateActionPermission } from "@/lib/actions/permissions";
import { getAction, UnknownActionError } from "@/lib/actions/registry";
import type {
  ActionDefinition,
  ActionErrorCode,
  ActionExecutionContext,
  ActionResult,
  ActionRunStatus,
  ActionRuntimeOutcome,
} from "@/lib/actions/types";
import { logError } from "@/lib/observability/logger";
import { operationalCodes } from "@/lib/observability/codes";

/** V1 bound: at most one Action execution per generation. */
export const MAX_ACTIONS_PER_GENERATION = 1;

/** Default Action wall-clock timeout (ms). */
export const ACTION_TIMEOUT_MS = 45_000;

export type ExecuteActionInput = {
  actionId: string;
  rawInput: unknown;
  ctx: ActionExecutionContext;
  /** Optional audit persistence. When omitted, runtime still returns a truthful outcome. */
  supabase?: SupabaseClient;
  /** Test/override: treat as already confirmed (future mutations). */
  confirmed?: boolean;
  /** Wall-clock timeout; defaults to ACTION_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Generation budget counter. Runtime refuses when already at MAX_ACTIONS_PER_GENERATION.
   * Caller owns the counter across invocations.
   */
  generationActionCount?: { current: number };
};

function failedResult(code: ActionErrorCode, message: string): ActionResult {
  return {
    ok: false,
    items: [],
    summary: message,
    errorCode: code,
    errorMessage: message,
  };
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "AbortError" || /abort|cancel/i.test(message);
}

/**
 * Execute one allowlisted Action: registry → validate → permission → execute → audit.
 * Prefer one call per generation. Never loops on model tool requests.
 */
export async function executeAction(input: ExecuteActionInput): Promise<ActionRuntimeOutcome> {
  const startedAt = new Date();
  const budget = input.generationActionCount;
  if (budget && budget.current >= MAX_ACTIONS_PER_GENERATION) {
    return finalizeWithoutAudit({
      actionId: input.actionId,
      capability: "read",
      startedAt,
      status: "failed",
      result: failedResult("budget_exceeded", "Only one Action is allowed per reply."),
      runId: randomUUID(),
    });
  }
  if (budget) budget.current += 1;

  const action = getAction(input.actionId);
  if (!action) {
    return finalizeWithoutAudit({
      actionId: input.actionId,
      capability: "read",
      startedAt,
      status: "failed",
      result: failedResult("unknown_action", "That Action is not available."),
      runId: randomUUID(),
    });
  }

  const parsed = action.inputSchema.safeParse(input.rawInput);
  if (!parsed.success) {
    return await finalize({
      action,
      input: input.rawInput,
      ctx: input.ctx,
      supabase: input.supabase,
      startedAt,
      status: "failed",
      result: failedResult("validation_failed", "Action input was invalid."),
    });
  }

  const permission = evaluateActionPermission(action, { confirmed: input.confirmed });
  if (!permission.allowed) {
    const status: ActionRunStatus =
      permission.code === "confirmation_required" ? "waiting_for_confirmation" : "failed";
    return await finalize({
      action,
      input: parsed.data,
      ctx: input.ctx,
      supabase: input.supabase,
      startedAt,
      status,
      result: failedResult(permission.code, permission.reason),
      metadata: permission.requiresConfirmation ? { requiresConfirmation: true } : undefined,
    });
  }

  if (input.ctx.signal.aborted) {
    return await finalize({
      action,
      input: parsed.data,
      ctx: input.ctx,
      supabase: input.supabase,
      startedAt,
      status: "cancelled",
      result: failedResult("aborted", "Action cancelled."),
    });
  }

  const timeoutMs = input.timeoutMs ?? ACTION_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any([input.ctx.signal, timeout])
      : input.ctx.signal;

  // When a persistence client is provided, require an audit row before execute.
  // Mutating Actions (future) and V1 reads both fail closed so successful work cannot lose its trail.
  let runId: string | null = null;
  if (input.supabase) {
    const row = await insertActionRun({
      supabase: input.supabase,
      userId: input.ctx.userId,
      roomId: input.ctx.roomId,
      conversationId: input.ctx.conversationId,
      messageId: input.ctx.messageId,
      actionId: action.id,
      capability: action.capability,
      inputSummary: sanitizeActionInputSummary(action.id, parsed.data),
      status: "running",
    });
    runId = row?.id ?? null;
    if (!runId) {
      logError("action.audit.insert_failed", {
        requestId: input.ctx.requestId,
        actionId: action.id,
        capability: action.capability,
        code: operationalCodes.requestFailed,
      });
      return finalizeWithoutAudit({
        actionId: action.id,
        capability: action.capability,
        startedAt,
        status: "failed",
        result: failedResult("execution_failed", "Action audit could not be recorded."),
        runId: randomUUID(),
      });
    }
  } else {
    runId = randomUUID();
  }

  try {
    const result = await action.execute(input.ctx, parsed.data, combined);
    const aborted = combined.aborted || input.ctx.signal.aborted;
    if (aborted && !result.ok) {
      const timedOut = timeout.aborted && !input.ctx.signal.aborted;
      return await seal({
        supabase: input.supabase,
        runId,
        userId: input.ctx.userId,
        action,
        startedAt,
        status: timedOut ? "failed" : "cancelled",
        result: failedResult(
          timedOut ? "timeout" : "aborted",
          timedOut ? "Action timed out." : "Action cancelled.",
        ),
      });
    }
    if (aborted && result.ok) {
      // Stop won after a successful execute — still report completed truthfully for the work done,
      // but prefer cancelled when the user Stop is the authority for the turn.
      if (input.ctx.signal.aborted) {
        return await seal({
          supabase: input.supabase,
          runId,
          userId: input.ctx.userId,
          action,
          startedAt,
          status: "cancelled",
          result: { ...result, ok: false, errorCode: "aborted", errorMessage: "Action cancelled.", summary: "Action cancelled." },
        });
      }
    }
    const status: ActionRunStatus = result.ok ? "completed" : "failed";
    return await seal({
      supabase: input.supabase,
      runId,
      userId: input.ctx.userId,
      action,
      startedAt,
      status,
      result: result.ok
        ? result
        : {
            ...result,
            errorCode: result.errorCode ?? "execution_failed",
          },
    });
  } catch (error) {
    const timedOut = timeout.aborted && !input.ctx.signal.aborted;
    const aborted = isAbortError(error) || input.ctx.signal.aborted || combined.aborted;
    if (timedOut) {
      return await seal({
        supabase: input.supabase,
        runId,
        userId: input.ctx.userId,
        action,
        startedAt,
        status: "failed",
        result: failedResult("timeout", "Action timed out."),
      });
    }
    if (aborted) {
      return await seal({
        supabase: input.supabase,
        runId,
        userId: input.ctx.userId,
        action,
        startedAt,
        status: "cancelled",
        result: failedResult("aborted", "Action cancelled."),
      });
    }
    return await seal({
      supabase: input.supabase,
      runId,
      userId: input.ctx.userId,
      action,
      startedAt,
      status: "failed",
      result: failedResult("execution_failed", "Action failed."),
    });
  }
}

async function finalize(args: {
  action: ActionDefinition;
  input: unknown;
  ctx: ActionExecutionContext;
  supabase?: SupabaseClient;
  startedAt: Date;
  status: ActionRunStatus;
  result: ActionResult;
  metadata?: Record<string, unknown>;
}): Promise<ActionRuntimeOutcome> {
  let runId: string = randomUUID();
  if (args.supabase) {
    const row = await insertActionRun({
      supabase: args.supabase,
      userId: args.ctx.userId,
      roomId: args.ctx.roomId,
      conversationId: args.ctx.conversationId,
      messageId: args.ctx.messageId,
      actionId: args.action.id,
      capability: args.action.capability,
      inputSummary: sanitizeActionInputSummary(args.action.id, args.input),
      status: args.status === "waiting_for_confirmation" ? "waiting_for_confirmation" : "running",
      metadata: args.metadata,
    });
    if (row) runId = row.id;
    if (args.status === "completed" || args.status === "failed" || args.status === "cancelled") {
      await completeActionRun({
        supabase: args.supabase,
        runId,
        userId: args.ctx.userId,
        status: args.status,
        errorCode: args.result.errorCode ?? null,
        metadata: args.metadata,
      });
    }
  }
  return {
    runId,
    actionId: args.action.id,
    capability: args.action.capability,
    status: args.status,
    result: args.result,
    startedAt: args.startedAt,
    completedAt: new Date(),
  };
}

async function seal(args: {
  supabase?: SupabaseClient;
  runId: string;
  userId: string;
  action: ActionDefinition;
  startedAt: Date;
  status: Extract<ActionRunStatus, "completed" | "failed" | "cancelled">;
  result: ActionResult;
}): Promise<ActionRuntimeOutcome> {
  if (args.supabase) {
    await completeActionRun({
      supabase: args.supabase,
      runId: args.runId,
      userId: args.userId,
      status: args.status,
      errorCode: args.result.errorCode ?? null,
      metadata: {
        itemCount: args.result.items.length,
        ok: args.result.ok,
      },
    });
  }
  return {
    runId: args.runId,
    actionId: args.action.id,
    capability: args.action.capability,
    status: args.status,
    result: args.result,
    startedAt: args.startedAt,
    completedAt: new Date(),
  };
}

function finalizeWithoutAudit(args: {
  actionId: string;
  capability: ActionDefinition["capability"];
  startedAt: Date;
  status: ActionRunStatus;
  result: ActionResult;
  runId: string;
}): ActionRuntimeOutcome {
  return {
    runId: args.runId,
    actionId: args.actionId,
    capability: args.capability,
    status: args.status,
    result: args.result,
    startedAt: args.startedAt,
    completedAt: new Date(),
  };
}

export { UnknownActionError };
