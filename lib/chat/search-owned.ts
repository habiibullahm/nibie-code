import "server-only";

import {
  ilikeContainsPattern,
  mapOwnedSearchRows,
  normalizeSearchQuery,
  sanitizeSearchableContent,
  SEARCH_MAX_RESULTS,
  SEARCH_MIN_CHARS,
  type ChatSearchPayload,
  type SearchConversationRow,
  type SearchMessageRow,
} from "@/lib/chat/search";

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;

/** Narrow facade over the authenticated Supabase client's filter builder. */
export type ChatSearchDb = {
  from: (table: "conversations" | "messages" | "rooms") => {
    select: (columns: string) => {
      ilike: (column: string, pattern: string) => {
        order: (column: string, options?: { ascending: boolean }) => {
          order: (column: string, options?: { ascending: boolean }) => {
            limit: (count: number) => QueryResult<SearchConversationRow>;
          };
          limit: (count: number) => QueryResult<SearchConversationRow>;
        };
        limit: (count: number) => QueryResult<SearchConversationRow>;
      };
      eq: (column: string, value: string) => {
        ilike: (column: string, pattern: string) => {
          order: (column: string, options?: { ascending: boolean }) => {
            limit: (count: number) => QueryResult<SearchMessageRow>;
          };
        };
      };
      in: (column: string, values: string[]) => QueryResult<SearchConversationRow> & QueryResult<{ id: string; name: string }>;
    };
  };
};

/**
 * Owner-scoped chat search via the authenticated Supabase client (RLS).
 * Never accepts a client-provided user id. Prefers no migration: bounded ILIKE reads.
 */
export async function searchOwnedChats(
  supabase: ChatSearchDb,
  rawQuery: unknown,
): Promise<{ ok: true; data: ChatSearchPayload } | { ok: false; error: string; status: number }> {
  const query = normalizeSearchQuery(rawQuery);
  if (!query || query.length < SEARCH_MIN_CHARS) {
    return { ok: false, error: "Enter at least two characters to search.", status: 400 };
  }

  const pattern = ilikeContainsPattern(query);
  const started = Date.now();

  // When the query is only LIKE metacharacters, skip the DB pattern and rely on empty results
  // (literal `%` / `_` matching is refined client-side when a broader pattern is used).
  let titleRows: SearchConversationRow[] = [];
  let messageRows: SearchMessageRow[] = [];
  let messageSearchFailed = false;

  if (pattern) {
    const titleResult = await supabase
      .from("conversations")
      .select("id,title,room_id,archived_at,updated_at")
      .ilike("title", pattern)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SEARCH_MAX_RESULTS);

    if (titleResult.error) {
      return { ok: false, error: "Search is temporarily unavailable.", status: 503 };
    }
    titleRows = titleResult.data ?? [];

    const messageResult = await supabase
      .from("messages")
      .select("id,conversation_id,role,content,created_at")
      .eq("status", "complete")
      .ilike("content", pattern)
      .order("created_at", { ascending: false })
      .limit(SEARCH_MAX_RESULTS);

    if (messageResult.error) {
      messageSearchFailed = true;
    } else {
      messageRows = messageResult.data ?? [];
    }
  }

  // Exact literal filter (case-insensitive) so stripped LIKE metacharacters cannot over-match.
  const needle = query.toLowerCase();
  titleRows = titleRows.filter((row) => row.title.toLowerCase().includes(needle));
  messageRows = messageRows.filter((row) => sanitizeSearchableContent(row.role, row.content).toLowerCase().includes(needle));

  const conversationIds = new Set(titleRows.map((row) => row.id));
  for (const row of messageRows) conversationIds.add(row.conversation_id);

  let conversationRows = titleRows;
  const missingIds = [...conversationIds].filter((id) => !conversationRows.some((row) => row.id === id));
  if (missingIds.length) {
    const extra = await supabase
      .from("conversations")
      .select("id,title,room_id,archived_at,updated_at")
      .in("id", missingIds);
    if (!extra.error && extra.data) {
      conversationRows = [...conversationRows, ...(extra.data as SearchConversationRow[])];
    } else if (extra.error) {
      messageSearchFailed = true;
      messageRows = [];
    }
  }

  const roomIds = [...new Set(conversationRows.map((row) => row.room_id).filter((id): id is string => Boolean(id)))];
  let rooms: { id: string; name: string }[] = [];
  if (roomIds.length) {
    const roomResult = await supabase
      .from("rooms")
      .select("id,name")
      .in("id", roomIds);
    if (!roomResult.error && roomResult.data) rooms = roomResult.data as { id: string; name: string }[];
  }

  const data = mapOwnedSearchRows({
    query,
    conversations: conversationRows,
    messages: messageRows,
    rooms,
    messageSearchFailed,
  });

  console.info(JSON.stringify({
    event: "chat.search.completed",
    durationMs: Date.now() - started,
    titleCount: data.conversations.length,
    messageCount: data.messages.length,
    archivedCount: data.archived.length,
    messageSearchFailed,
    queryLength: query.length,
  }));

  return { ok: true, data };
}
