import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { actionStatusLabel } from "@/lib/actions/labels";
import type { ActionRunStatus } from "@/lib/actions/types";

/** Durable Action view hydrated onto assistant messages from action_runs. */
export type MessageActionView = {
  actionId: string;
  status: ActionRunStatus;
  /** User-facing label derived from actionId + status (e.g. "Used Web Search"). */
  label: string;
};

/**
 * Load completed Action runs for a conversation, keyed by assistant message_id.
 * Soft-fail when the table is missing (not migrated). Prefer latest completed run per message.
 */
export async function loadMessageActionsByConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<{ byMessage: Map<string, MessageActionView>; error: boolean; unavailable: boolean }> {
  try {
    const { data, error } = await supabase
      .from("action_runs")
      .select("message_id,action_id,status,started_at")
      .eq("conversation_id", conversationId)
      .eq("status", "completed")
      .not("message_id", "is", null)
      .order("started_at", { ascending: false });
    if (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code ?? "") : "";
      if (code === "42P01" || code === "PGRST205") {
        return { byMessage: new Map(), error: false, unavailable: true };
      }
      return { byMessage: new Map(), error: true, unavailable: false };
    }
    const byMessage = new Map<string, MessageActionView>();
    for (const row of data ?? []) {
      const messageId = typeof row.message_id === "string" ? row.message_id : null;
      const actionId = typeof row.action_id === "string" ? row.action_id.trim() : "";
      const status = row.status as ActionRunStatus;
      if (!messageId || !actionId || status !== "completed") continue;
      if (byMessage.has(messageId)) continue; // already have a newer completed run
      const label = actionStatusLabel(actionId, status);
      if (!label) continue;
      byMessage.set(messageId, { actionId, status, label });
    }
    return { byMessage, error: false, unavailable: false };
  } catch {
    return { byMessage: new Map(), error: true, unavailable: false };
  }
}
