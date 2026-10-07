import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageResearchView, ResearchRunMetrics, ResearchRunStatus } from "@/lib/research/types";
import { RESEARCH_USAGE_POLICY } from "@/lib/research/usage-policy";

export type { MessageResearchView };

export type PersistResearchMetaInput = {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  messageId: string;
  status: ResearchRunStatus;
  metrics: ResearchRunMetrics;
  followUpUsed: boolean;
};

/**
 * Persist high-level Deep Research run metadata (counts/duration only — no CoT, queries, or page text).
 * Soft-fail: never throws to the chat route.
 */
export async function persistMessageResearch(input: PersistResearchMetaInput): Promise<{ ok: boolean; unavailable?: boolean }> {
  try {
    const row = {
      user_id: input.userId,
      conversation_id: input.conversationId,
      message_id: input.messageId,
      status: input.status === "running" ? "incomplete" : input.status,
      follow_up_used: input.followUpUsed,
      search_query_count: input.metrics.searchQueryCount,
      search_result_count: input.metrics.searchResultCount,
      pages_fetched: input.metrics.pagesFetched,
      pages_failed: input.metrics.pagesFailed,
      evidence_count: input.metrics.evidenceCount,
      model_call_count: input.metrics.modelCallCount,
      duration_ms: input.metrics.durationMs,
      time_sensitive: input.metrics.timeSensitive,
      usage_policy: RESEARCH_USAGE_POLICY.id,
      incomplete_reason: input.metrics.incompleteReason ?? null,
    };
    const { error } = await input.supabase.from("message_research").upsert(row, { onConflict: "message_id" });
    if (error) {
      // Missing table (not migrated) — soft unavailable.
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code ?? "") : "";
      if (code === "42P01" || code === "PGRST205") return { ok: false, unavailable: true };
      return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function loadMessageResearchByConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<{ byMessage: Map<string, MessageResearchView>; error: boolean; unavailable: boolean }> {
  try {
    const { data, error } = await supabase
      .from("message_research")
      .select("message_id,status,follow_up_used,search_query_count,pages_fetched,evidence_count,duration_ms,usage_policy")
      .eq("conversation_id", conversationId);
    if (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code ?? "") : "";
      if (code === "42P01" || code === "PGRST205") {
        return { byMessage: new Map(), error: false, unavailable: true };
      }
      return { byMessage: new Map(), error: true, unavailable: false };
    }
    const byMessage = new Map<string, MessageResearchView>();
    for (const row of data ?? []) {
      byMessage.set(row.message_id, {
        status: row.status,
        followUpUsed: Boolean(row.follow_up_used),
        searchQueryCount: Number(row.search_query_count) || 0,
        pagesFetched: Number(row.pages_fetched) || 0,
        evidenceCount: Number(row.evidence_count) || 0,
        durationMs: Number(row.duration_ms) || 0,
        usagePolicy: String(row.usage_policy ?? RESEARCH_USAGE_POLICY.id),
      });
    }
    return { byMessage, error: false, unavailable: false };
  } catch {
    return { byMessage: new Map(), error: true, unavailable: false };
  }
}
