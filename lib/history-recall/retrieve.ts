import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeSearchableContent } from "@/lib/chat/search";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import type { HistoryRecallIntent } from "./intent";

export const HISTORY_RECALL_LIMITS = {
  candidates: 24,
  results: 4,
  excerptChars: 360,
  totalExcerptChars: 1440,
  deadlineMs: 1200,
} as const;

export type HistoryConversation = {
  id: string;
  user_id: string;
  room_id: string | null;
  archived_at: string | null;
  title: string;
};
export type HistoryCandidate = {
  id: string;
  user_id: string;
  conversation_id: string;
  role: "user" | "assistant";
  status: string;
  content: string;
  created_at: string;
  conversations: HistoryConversation;
};
export type HistoryEvidence = {
  messageId: string;
  conversationId: string;
  title: string;
  role: "user" | "assistant";
  createdAt: string;
  excerpt: string;
};
export type HistoryRecallResult = {
  status: "found" | "empty" | "scope_unavailable" | "unsupported_scope" | "unavailable" | "cancelled";
  evidence: HistoryEvidence[];
  limited: boolean;
};

function inScope(row: HistoryConversation, ownerId: string, roomId: string | null) {
  return row.user_id === ownerId && row.room_id === roomId && row.archived_at === null;
}

/** Find the tightest word window, including later occurrences of a topic term. */
function excerptForTerms(text: string, terms: string[]): string | null {
  if (!terms.length) return null;
  const occurrences = terms.flatMap((term, termIndex) =>
    [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${term}(?![\\p{L}\\p{N}])`, "giu"))]
      .map((match) => ({ start: match.index, end: match.index + match[0].length, termIndex })),
  ).sort((a, b) => a.start - b.start || a.end - b.end);
  const counts: number[] = Array(terms.length).fill(0);
  const maxChars = HISTORY_RECALL_LIMITS.excerptChars - 2;
  let covered = 0;
  let left = 0;
  let best: { start: number; end: number } | null = null;
  for (const occurrence of occurrences) {
    if (counts[occurrence.termIndex]++ === 0) covered++;
    while (covered === terms.length) {
      const start = occurrences[left].start;
      const span = occurrence.end - start;
      if (span <= maxChars && (!best || span < best.end - best.start)) {
        best = { start, end: occurrence.end };
      }
      if (--counts[occurrences[left++].termIndex] === 0) covered--;
    }
  }
  if (!best) return null;
  // Spend only the remaining space on leading context so the last term survives.
  const start = Math.max(0, best.start - Math.min(100, maxChars - (best.end - best.start)));
  const end = Math.min(text.length, start + maxChars);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Rank lexical evidence only; never interpret snippets as decisions or instructions. */
export function selectHistoryEvidence(input: {
  candidates: HistoryCandidate[];
  intent: HistoryRecallIntent;
  ownerId: string;
  conversationId: string;
  roomId: string | null;
}): HistoryEvidence[] {
  const { intent } = input;
  const ranked = input.candidates.filter((row) =>
    row.user_id === input.ownerId && row.status === "complete"
    && (row.role === "user" || row.role === "assistant")
    && row.conversation_id !== input.conversationId
    && row.conversations?.id === row.conversation_id
    && inScope(row.conversations, input.ownerId, input.roomId),
  ).flatMap((row) => {
    const text = sanitizeSearchableContent(row.role, row.content).replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    // Require every topic token. Avoid replacing missing evidence with a loosely
    // related hit (e.g. Redis billing when the user asks Redis eviction).
    const excerpt = excerptForTerms(text, intent.terms);
    if (!excerpt) return [];
    return [{ row, excerpt, score: lower.includes(intent.topic.toLowerCase()) ? 2 : 1 }];
  }).sort((a, b) => b.score - a.score || b.row.created_at.localeCompare(a.row.created_at) || a.row.id.localeCompare(b.row.id));
  const seen = new Set<string>();
  return ranked.filter(({ row }) => !seen.has(row.id) && Boolean(seen.add(row.id)))
    .slice(0, HISTORY_RECALL_LIMITS.results)
    .map(({ row, excerpt }) => ({
      messageId: row.id, conversationId: row.conversation_id,
      title: row.conversations.title.slice(0, 120), role: row.role,
      createdAt: row.created_at, excerpt,
    }));
}

/** Authenticated publishable-key client only. Every scope filter precedes LIMIT. */
export async function retrieveHistoryEvidence(input: {
  supabase: SupabaseClient;
  ownerId: string;
  conversationId: string;
  roomId: string | null;
  intent: HistoryRecallIntent;
  signal: AbortSignal;
}): Promise<HistoryRecallResult> {
  const result = (status: HistoryRecallResult["status"]): HistoryRecallResult => ({ status, evidence: [], limited: false });
  if (input.signal.aborted) return result("cancelled");
  if (input.intent.unsupportedScope || !input.intent.terms.length) return result("unsupported_scope");
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<HistoryRecallResult>((resolve) => {
    signal.addEventListener("abort", () => resolve(result(input.signal.aborted ? "cancelled" : "unavailable")), { once: true });
    timer = setTimeout(() => controller.abort(), HISTORY_RECALL_LIMITS.deadlineMs);
  });
  const work = async (): Promise<HistoryRecallResult> => {
    const { supabase, ownerId, conversationId, roomId, intent } = input;
    const verifyCurrent = async () => {
      let currentQuery = supabase.from("conversations")
        .select("id,user_id,room_id,archived_at,title").eq("id", conversationId)
        .eq("user_id", ownerId).is("archived_at", null);
      currentQuery = roomId === null ? currentQuery.is("room_id", null) : currentQuery.eq("room_id", roomId);
      const current = await currentQuery.abortSignal(signal).maybeSingle();
      if (current.error || !current.data || !inScope(current.data as HistoryConversation, ownerId, roomId)) return false;
      if (roomId !== null) {
        const room = await supabase.from("rooms").select("id").eq("id", roomId)
          .eq("user_id", ownerId).abortSignal(signal).maybeSingle();
        if (room.error || !room.data) return false;
      }
      return !signal.aborted;
    };
    if (!await verifyCurrent()) return result("scope_unavailable");
    const authorizedMessages = (excludeTemporary: boolean) => {
      let query = supabase.from("messages")
        .select("id,user_id,conversation_id,role,status,content,created_at,conversations!inner(id,user_id,room_id,archived_at,title)")
        .eq("user_id", ownerId).eq("conversations.user_id", ownerId)
        .eq("status", "complete").is("conversations.archived_at", null)
        .neq("conversation_id", conversationId);
      // Temporary chats are never recalled from another conversation.
      if (excludeTemporary) query = query.is("conversations.temporary_expires_at", null);
      // Topic words are ANDed before LIMIT so unrelated newer messages containing
      // only one word cannot crowd an older multi-word decision out of the pool.
      for (const term of intent.terms) query = query.ilike("content", `%${term}%`);
      return roomId === null ? query.is("conversations.room_id", null) : query.eq("conversations.room_id", roomId);
    };
    const readCandidates = (excludeTemporary: boolean) => authorizedMessages(excludeTemporary)
      .order("created_at", { ascending: false }).order("id", { ascending: true })
      .limit(HISTORY_RECALL_LIMITS.candidates).abortSignal(signal);
    let excludeTemporary = true;
    let read = await readCandidates(excludeTemporary);
    // A database without temporary chats yet has none to exclude.
    if (schemaUnavailable(read.error)) read = await readCandidates(excludeTemporary = false);
    if (read.error) return result("unavailable");
    const candidates = (read.data ?? []) as unknown as HistoryCandidate[];
    let evidence = selectHistoryEvidence({ candidates, intent, ownerId, conversationId, roomId });
    // Recheck after retrieval: a Room deletion/move/archive or permission change
    // during the lookup cannot silently broaden the request into General.
    if (!await verifyCurrent()) return result("scope_unavailable");
    if (evidence.length) {
      // Re-read the selected messages, not just conversation metadata: a deleted,
      // edited or newly inaccessible message cannot survive the recheck as an
      // old excerpt. Inner-relation filters revalidate the source scope too.
      const selectedIds = new Set(evidence.map((row) => row.messageId));
      const sources = await authorizedMessages(excludeTemporary).in("id", [...selectedIds])
        .limit(HISTORY_RECALL_LIMITS.results).abortSignal(signal);
      if (sources.error) return result("unavailable");
      const refreshed = selectHistoryEvidence({ candidates: (sources.data ?? []) as unknown as HistoryCandidate[], intent, ownerId, conversationId, roomId });
      if (refreshed.length !== selectedIds.size || refreshed.some((row) => !selectedIds.has(row.messageId))) return result("scope_unavailable");
      evidence = refreshed;
    }
    if (signal.aborted) return result(input.signal.aborted ? "cancelled" : "unavailable");
    return { status: evidence.length ? "found" : "empty", evidence, limited: candidates.length >= HISTORY_RECALL_LIMITS.candidates };
  };
  try { return await Promise.race([work(), stopped]); }
  catch { return result(input.signal.aborted ? "cancelled" : "unavailable"); }
  finally { clearTimeout(timer); controller.abort(); }
}
