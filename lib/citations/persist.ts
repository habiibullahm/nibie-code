import "server-only";

import { schemaUnavailable } from "@/lib/chat/schema-error";
import { toCitationSourceViews } from "@/lib/citations/prepare";
import type { CitationSourceView, SourceReference } from "@/lib/citations/types";

type QueryError = { code?: string; message?: string } | null;

type MessageSourceRow = {
  message_id: string;
  ordinal: number;
  kind: "web" | "room_file" | "attachment";
  title: string;
  url: string | null;
  domain: string | null;
};

type InsertResult = { error: QueryError };
type SelectResult = { data: MessageSourceRow[] | null; error: QueryError };

/**
 * Persist prepared sources for an assistant message. Soft-fails when the table is not deployed yet.
 * Call once when the reply is saved as complete (or interrupted with visible text + sources).
 */
export async function persistMessageSources(input: {
  supabase: { from: (table: string) => unknown };
  userId: string;
  conversationId: string;
  messageId: string;
  sources: readonly SourceReference[];
}): Promise<{ ok: boolean; unavailable?: boolean }> {
  if (!input.sources.length) return { ok: true };
  const rows = input.sources.map((source, index) => ({
    user_id: input.userId,
    conversation_id: input.conversationId,
    message_id: input.messageId,
    ordinal: index + 1,
    kind: source.kind,
    handle: source.id,
    title: source.title,
    url: source.url,
    domain: source.domain,
    excerpt: source.excerpt ?? null,
    retrieved_at: source.retrievedAt ? new Date(source.retrievedAt).toISOString() : null,
    source_id: source.sourceId ?? null,
  }));
  const table = input.supabase.from("message_sources") as {
    insert: (rows: unknown) => PromiseLike<InsertResult>;
  };
  const { error } = await table.insert(rows);
  if (!error) return { ok: true };
  if (schemaUnavailable(error)) return { ok: true, unavailable: true };
  // Unique on (message_id, ordinal|handle): a Stop/generation race may insert twice — treat as already saved.
  if (error.code === "23505") return { ok: true };
  return { ok: false };
}

/** Load citation views for messages in a conversation (owner-scoped via RLS). */
export async function loadMessageSourcesByConversation(
  supabase: { from: (table: string) => unknown },
  conversationId: string,
): Promise<{ byMessage: Map<string, CitationSourceView[]>; error: boolean; unavailable: boolean }> {
  const table = supabase.from("message_sources") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, opts: { ascending: boolean }) => PromiseLike<SelectResult>;
      };
    };
  };
  const { data, error } = await table
    .select("message_id,ordinal,kind,title,url,domain")
    .eq("conversation_id", conversationId)
    .order("ordinal", { ascending: true });

  if (error) {
    if (schemaUnavailable(error)) return { byMessage: new Map(), error: false, unavailable: true };
    return { byMessage: new Map(), error: true, unavailable: false };
  }

  const byMessage = new Map<string, CitationSourceView[]>();
  for (const row of data ?? []) {
    const view: CitationSourceView = {
      ordinal: row.ordinal,
      kind: row.kind,
      title: row.title,
      url: row.url,
      domain: row.domain,
    };
    const list = byMessage.get(row.message_id) ?? [];
    list.push(view);
    byMessage.set(row.message_id, list);
  }
  return { byMessage, error: false, unavailable: false };
}

export function citationViewsFromPrepared(sources: readonly SourceReference[]): CitationSourceView[] {
  return toCitationSourceViews(sources);
}
