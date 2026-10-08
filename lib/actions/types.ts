import type { z } from "zod";

/** Capability classes for Actions. Mutations are designed but not generally enabled in V1. */
export type ActionCapability = "read" | "create" | "update" | "delete" | "execute";

/** Lifecycle statuses persisted on action_runs and returned by the runtime. */
export type ActionRunStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_for_confirmation";

export type ActionErrorCode =
  | "unknown_action"
  | "validation_failed"
  | "permission_denied"
  | "confirmation_required"
  | "timeout"
  | "aborted"
  | "execution_failed"
  | "budget_exceeded";

export type ActionResultItem = {
  title: string;
  url?: string;
  snippet?: string;
  provenance?: string;
  /** Opaque structured fields safe for model context (no secrets). */
  data?: Record<string, unknown>;
};

export type ActionResult = {
  ok: boolean;
  /** Structured items for model synthesis / citations. Empty when failed/cancelled. */
  items: ActionResultItem[];
  /** Safe, user-facing summary (no secrets). */
  summary: string;
  errorCode?: ActionErrorCode;
  /** Safe error detail for logs/audit — never secrets or stack traces to the client. */
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export type ActionExecutionContext = {
  userId: string;
  conversationId: string;
  roomId?: string | null;
  messageId?: string | null;
  requestId: string;
  /** Generation abort — Stop and disconnect must cancel in-flight Actions. */
  signal: AbortSignal;
};

/**
 * Server-owned Action definition. The model never supplies code, handler names,
 * credentials, or permissions — only an allowlisted id + validated input.
 */
export type ActionDefinition<TInput extends z.ZodType = z.ZodType> = {
  id: string;
  title: string;
  description: string;
  capability: ActionCapability;
  inputSchema: TInput;
  /**
   * Future mutations: when true, runtime refuses until a confirmation token is present.
   * V1 reads ignore this (always false for web.search).
   */
  requiresConfirmation?: boolean;
  execute: (
    ctx: ActionExecutionContext,
    input: z.infer<TInput>,
    signal: AbortSignal,
  ) => Promise<ActionResult>;
};

export type ActionRunRecord = {
  id: string;
  userId: string;
  roomId: string | null;
  conversationId: string;
  messageId: string | null;
  actionId: string;
  capability: ActionCapability;
  inputSummary: string;
  status: ActionRunStatus;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown> | null;
};

export type ActionRuntimeOutcome = {
  runId: string;
  actionId: string;
  capability: ActionCapability;
  status: ActionRunStatus;
  result: ActionResult;
  startedAt: Date;
  completedAt: Date;
};
