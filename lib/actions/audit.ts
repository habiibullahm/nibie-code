import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionCapability, ActionErrorCode, ActionRunStatus } from "@/lib/actions/types";

const SECRET_KEY =
  /^(?:.*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|cookie|credential|bearer|private[_-]?key).*)$/i;
const SECRET_VALUE =
  /\b(?:sk-[a-zA-Z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;

const MAX_SUMMARY_LEN = 240;

/**
 * Build a sanitized, length-capped input summary for action_runs.
 * Never persist secrets, tokens, cookies, or raw credentials.
 */
export function sanitizeActionInputSummary(
  actionId: string,
  input: unknown,
): string {
  const safe = redactValue(input);
  let summary: string;
  try {
    summary = typeof safe === "string" ? safe : JSON.stringify(safe);
  } catch {
    summary = `{"action":${JSON.stringify(actionId)}}`;
  }
  summary = summary.replace(SECRET_VALUE, "[redacted]");
  if (summary.length > MAX_SUMMARY_LEN) {
    summary = `${summary.slice(0, MAX_SUMMARY_LEN - 1)}…`;
  }
  return summary || actionId;
}

function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE, "[redacted]").slice(0, 200);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactValue(child);
      }
    }
    return out;
  }
  return String(value).slice(0, 80);
}

export type InsertActionRunInput = {
  supabase: SupabaseClient;
  userId: string;
  roomId?: string | null;
  conversationId: string;
  messageId?: string | null;
  actionId: string;
  capability: ActionCapability;
  inputSummary: string;
  status?: Extract<ActionRunStatus, "requested" | "running" | "waiting_for_confirmation">;
  metadata?: Record<string, unknown> | null;
};

export type ActionRunRow = {
  id: string;
  status: ActionRunStatus;
  started_at: string;
};

/**
 * Insert a new action_runs row via server-controlled RPC (non-terminal statuses only).
 * Returns null on persistence failure; `executeAction` fails closed before running the Action when supabase is provided.
 */
export async function insertActionRun(input: InsertActionRunInput): Promise<ActionRunRow | null> {
  const status = input.status ?? "running";
  const { data, error } = await input.supabase
    .rpc("insert_action_run", {
      p_conversation_id: input.conversationId,
      p_action_id: input.actionId,
      p_capability: input.capability,
      p_input_summary: input.inputSummary.slice(0, MAX_SUMMARY_LEN),
      p_status: status,
      p_room_id: input.roomId ?? null,
      p_message_id: input.messageId ?? null,
      p_metadata: sanitizeMetadata(input.metadata ?? null),
    })
    .single<ActionRunRow>();
  if (error || !data?.id) return null;
  return data;
}

export type CompleteActionRunInput = {
  supabase: SupabaseClient;
  runId: string;
  userId: string;
  status: Extract<ActionRunStatus, "completed" | "failed" | "cancelled">;
  errorCode?: ActionErrorCode | string | null;
  metadata?: Record<string, unknown> | null;
};

/** Finalize a non-terminal action_runs row via server-controlled RPC. */
export async function completeActionRun(input: CompleteActionRunInput): Promise<boolean> {
  const { data, error } = await input.supabase.rpc("complete_action_run", {
    p_run_id: input.runId,
    p_status: input.status,
    p_error_code: input.errorCode ?? null,
    p_metadata: sanitizeMetadata(input.metadata ?? null),
  });
  return Boolean(!error && data === true);
}

function sanitizeMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  const redacted = redactValue(metadata);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return null;
  return redacted as Record<string, unknown>;
}
