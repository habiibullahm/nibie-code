import "server-only";

import { after } from "next/server";
import { z } from "zod";
import { chatProvider, type ChatProvider } from "@/lib/ai/provider";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import type { ThreadMessage, ThreadSummary } from "@/lib/context/context-types";
import { generateThreadSummary, SummaryGenerationError } from "@/lib/context/thread-summary-generation";
import { decideThreadSummary, selectSummaryInput, type SummaryDecision } from "@/lib/context/thread-summary-lifecycle";
import { logInfo, logWarn } from "@/lib/observability/logger";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

// The signed-in owner's client. Row-level security scopes every read and write here; nothing in this module uses a service key.
type SummaryClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const summaryColumns = "objective,important_context,decisions,completed_work,current_state,open_questions,covers_through_position,updated_at";
// Rows read by one maintenance job. A longer backlog is summarized up to the last row read and caught up on a later reply.
const SUMMARY_SOURCE_ROW_LIMIT = 120;
// Longer than the chat route's own provider timeout, so a reply always settles first.
const OUTCOME_WAIT_MS = 150_000;

const summaryRowSchema = z.object({
  objective: z.string(),
  important_context: z.string(),
  decisions: z.string(),
  completed_work: z.string(),
  current_state: z.string(),
  open_questions: z.string(),
  covers_through_position: z.number().int().positive(),
  updated_at: z.string().min(1),
});

function fromRow(row: z.infer<typeof summaryRowSchema>): ThreadSummary {
  return {
    objective: row.objective,
    importantContext: row.important_context,
    decisions: row.decisions,
    completedWork: row.completed_work,
    currentState: row.current_state,
    openQuestions: row.open_questions,
    coversThroughPosition: row.covers_through_position,
    updatedAt: row.updated_at,
  };
}

type SummaryRead = { ok: true; summary: ThreadSummary | null } | { ok: false; reason: "read_failed" | "invalid_row" };

async function readSummary(supabase: SummaryClient, conversationId: string): Promise<SummaryRead> {
  try {
    const { data, error } = await supabase.from("thread_summaries").select(summaryColumns).eq("conversation_id", conversationId).maybeSingle();
    // A database that has not been migrated yet simply has no summaries.
    if (error) return schemaUnavailable(error) ? { ok: true, summary: null } : { ok: false, reason: "read_failed" };
    if (!data) return { ok: true, summary: null };
    const parsed = summaryRowSchema.safeParse(data);
    return parsed.success ? { ok: true, summary: fromRow(parsed.data) } : { ok: false, reason: "invalid_row" };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}

// For the chat request. Never throws: a failed read is reported and the reply continues without a summary.
export async function loadThreadSummary(supabase: SummaryClient, conversationId: string, requestId: string): Promise<ThreadSummary | null> {
  const result = await readSummary(supabase, conversationId);
  if (result.ok) return result.summary;
  logWarn("thread_summary.read.failed", { requestId, reason: result.reason });
  return null;
}

export type ThreadSummaryJob = {
  supabase: SummaryClient;
  conversationId: string;
  // Position of the assistant reply that was just saved as complete.
  assistantPosition: number;
  requestId: string;
  provider?: ChatProvider;
};

function failureReason(error: unknown) {
  return error instanceof SummaryGenerationError ? error.reason : "unexpected";
}

// Best effort. Never throws and never touches the reply it follows: a failure leaves the stored summary (if any) as it was.
export async function runThreadSummaryMaintenance(job: ThreadSummaryJob): Promise<void> {
  const startedAt = Date.now();
  const durationMs = () => Date.now() - startedAt;
  const { supabase, conversationId, requestId } = job;
  let decision: SummaryDecision | null = null;
  try {
    const [existing, counted] = await Promise.all([
      readSummary(supabase, conversationId),
      supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("status", "complete"),
    ]);
    if (!existing.ok) {
      logWarn("thread_summary.refresh.failed", { requestId, stage: "read", reason: existing.reason, durationMs: durationMs() });
      return;
    }
    if (counted.error || typeof counted.count !== "number") {
      logWarn("thread_summary.refresh.failed", { requestId, stage: "count", reason: "read_failed", durationMs: durationMs() });
      return;
    }
    decision = decideThreadSummary({
      outcome: "complete",
      assistantPosition: job.assistantPosition,
      completeMessageCount: counted.count,
      existingCoverage: existing.summary?.coversThroughPosition ?? null,
    });
    if (decision.action === "skip") {
      logInfo("thread_summary.refresh.skipped", { requestId, reason: decision.reason });
      return;
    }

    const coveredThrough = decision.action === "refresh" ? decision.fromCoverage : 0;
    const { data: rows, error: rowsError } = await supabase.from("messages").select("role,content,position")
      .eq("conversation_id", conversationId).eq("status", "complete").gt("position", coveredThrough).lte("position", decision.targetCoverage)
      .order("position", { ascending: true }).limit(SUMMARY_SOURCE_ROW_LIMIT);
    if (rowsError || !Array.isArray(rows)) {
      logWarn("thread_summary.refresh.failed", { requestId, stage: "messages", reason: "read_failed", durationMs: durationMs() });
      return;
    }
    const messages = (rows as { role: string; content: unknown; position: unknown }[])
      .filter((row): row is ThreadMessage => (row.role === "user" || row.role === "assistant") && typeof row.content === "string" && Number.isInteger(row.position));
    // A full page may stop short of the target; claim only what was actually read so no position is skipped.
    const readThrough = rows.length === SUMMARY_SOURCE_ROW_LIMIT && messages.length ? messages[messages.length - 1].position : decision.targetCoverage;
    const slice = selectSummaryInput(messages, { ...decision, targetCoverage: Math.min(decision.targetCoverage, readThrough) });
    if (!slice) {
      logInfo("thread_summary.refresh.skipped", { requestId, reason: "no_messages" });
      return;
    }

    logInfo("thread_summary.refresh.started", { requestId, kind: decision.action, inputMessageCount: slice.messages.length, coversThroughPosition: slice.coversThroughPosition });
    const fields = await generateThreadSummary({ provider: job.provider ?? chatProvider, existing: existing.summary, messages: slice.messages });

    const { data: saved, error: saveError } = await supabase.rpc("save_thread_summary", {
      p_conversation_id: conversationId,
      p_objective: fields.objective,
      p_important_context: fields.importantContext,
      p_decisions: fields.decisions,
      p_completed_work: fields.completedWork,
      p_current_state: fields.currentState,
      p_open_questions: fields.openQuestions,
      p_covers_through_position: slice.coversThroughPosition,
    });
    if (saveError) {
      logWarn("thread_summary.refresh.failed", { requestId, stage: "save", reason: "persist_failed", durationMs: durationMs() });
      return;
    }
    // A newer job already stored equal or greater coverage; this candidate is discarded.
    if (saved !== true) {
      logInfo("thread_summary.refresh.skipped", { requestId, reason: "superseded", durationMs: durationMs() });
      return;
    }
    logInfo("thread_summary.refresh.completed", { requestId, kind: decision.action, coversThroughPosition: slice.coversThroughPosition, durationMs: durationMs() });
  } catch (error) {
    logWarn("thread_summary.refresh.failed", { requestId, stage: decision ? "generate" : "prepare", reason: failureReason(error), durationMs: durationMs() });
  }
}

export type DeferredThreadSummary = {
  // The reply was saved as complete. Only this lets maintenance run.
  complete(assistantPosition: number): void;
  // The reply ended (any outcome). Without an earlier complete(), nothing runs.
  finish(): void;
};

// Registered with after() while the request is still open, so the work runs once the response has finished streaming and
// never delays the reply. The outcome is only known when the stream ends, hence the deferred hand-off. Call it only where every
// later path reaches finish(); the guard below is a backstop so a missed hand-off cannot hold the function open.
export function deferThreadSummaryMaintenance(job: Omit<ThreadSummaryJob, "assistantPosition">): DeferredThreadSummary {
  let settle: (position: number | null) => void = () => undefined;
  const outcome = new Promise<number | null>((resolve) => { settle = resolve; });
  const guard = setTimeout(() => settle(null), OUTCOME_WAIT_MS);
  guard.unref?.();
  void outcome.then(() => clearTimeout(guard));
  try {
    after(async () => {
      const assistantPosition = await outcome;
      if (assistantPosition === null) return;
      await runThreadSummaryMaintenance({ ...job, assistantPosition });
    });
  } catch {
    // No request scope to run after (for example outside the Next runtime): the summary simply is not refreshed this time.
    logWarn("thread_summary.refresh.skipped", { requestId: job.requestId, reason: "after_unavailable" });
    settle(null);
  }
  return {
    complete(assistantPosition) { settle(assistantPosition); },
    finish() { settle(null); },
  };
}
