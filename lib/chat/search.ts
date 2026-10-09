import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";

/** Minimum meaningful characters before content search runs. */
export const SEARCH_MIN_CHARS = 2;
/** Hard cap on query length accepted from the client. */
export const SEARCH_MAX_QUERY = 100;
/** Maximum combined results returned to the client. */
export const SEARCH_MAX_RESULTS = 25;
/** Client debounce before issuing a content-search request. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Visible snippet length around a match (characters). */
export const SEARCH_SNIPPET_RADIUS = 56;
export const SEARCH_SNIPPET_MAX = 140;

export type ChatSearchRole = "user" | "assistant";

export type ChatSearchConversationHit = {
  kind: "conversation";
  conversationId: string;
  title: string;
  roomId: string | null;
  roomName: string | null;
  archived: boolean;
};

export type ChatSearchMessageHit = {
  kind: "message";
  conversationId: string;
  messageId: string;
  title: string;
  snippet: string;
  role: ChatSearchRole;
  roomId: string | null;
  roomName: string | null;
  archived: boolean;
};

export type ChatSearchHit = ChatSearchConversationHit | ChatSearchMessageHit;

export type ChatSearchPayload = {
  query: string;
  conversations: ChatSearchConversationHit[];
  messages: ChatSearchMessageHit[];
  archived: ChatSearchHit[];
  /** True when message content search could not be completed. */
  messageSearchFailed?: boolean;
};

export type LocalSearchMessage = {
  id: string;
  role: ChatSearchRole;
  content: string;
  status?: string;
};

export type LocalSearchConversation = {
  id: string;
  title: string;
  room_id: string | null;
  archived_at?: string | null;
  updated_at?: string;
  messages?: LocalSearchMessage[];
};

/** Trim, collapse internal whitespace for comparison, and enforce the length cap. */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, SEARCH_MAX_QUERY);
}

/**
 * Build a safe ILIKE contains pattern.
 * PostgREST `.ilike` has no ESCAPE clause, so `%` / `_` cannot be quoted as literals.
 * Metacharacters are removed from the DB pattern; callers must re-filter with the original query.
 */
export function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "");
}

export function ilikeContainsPattern(query: string): string | null {
  const safe = escapeIlikePattern(query);
  if (!safe) return null;
  return `%${safe}%`;
}

/** Strip assistant reasoning markers before indexing or snippetting. */
export function sanitizeSearchableContent(role: ChatSearchRole, content: string): string {
  if (role !== "assistant") return content;
  return sanitizeModelOutput(content).text;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Match-centered excerpt, capped for the result row. */
export function extractSnippet(content: string, query: string, maxLength = SEARCH_SNIPPET_MAX): string {
  const text = collapseWhitespace(content);
  if (!text) return "";
  const needle = query.trim();
  if (!needle) return text.slice(0, maxLength);
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle.toLowerCase());
  if (index < 0) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
  }
  const start = Math.max(0, index - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(text.length, index + needle.length + SEARCH_SNIPPET_RADIUS);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  if (snippet.length > maxLength) {
    const matchOffset = snippet.toLowerCase().indexOf(needle.toLowerCase());
    if (matchOffset >= 0) {
      const keepStart = Math.max(0, matchOffset - Math.floor((maxLength - needle.length) / 2));
      snippet = snippet.slice(keepStart, keepStart + maxLength);
      if (keepStart > 0) snippet = `…${snippet}`;
      if (keepStart + maxLength < text.length) snippet = `${snippet.replace(/…$/, "")}…`;
    } else {
      snippet = `${snippet.slice(0, maxLength - 1)}…`;
    }
  }
  return snippet;
}

export type HighlightPart = { text: string; match: boolean };

/** Split text into safe React-renderable parts around case-insensitive matches. */
export function highlightMatchParts(text: string, query: string): HighlightPart[] {
  const needle = query.trim();
  if (!needle || !text) return text ? [{ text, match: false }] : [];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const found = lowerText.indexOf(lowerNeedle, cursor);
    if (found < 0) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (found > cursor) parts.push({ text: text.slice(cursor, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    cursor = found + needle.length;
  }
  return parts;
}

function roomNameFor(roomId: string | null | undefined, rooms: Map<string, string>): string | null {
  if (!roomId) return null;
  return rooms.get(roomId) ?? null;
}

export function filterTitleMatches(
  conversations: LocalSearchConversation[],
  query: string,
  rooms: Map<string, string>,
  archived: boolean,
): ChatSearchConversationHit[] {
  const needle = query.toLowerCase();
  return conversations
    .filter((item) => Boolean(item.archived_at) === archived && item.title.toLowerCase().includes(needle))
    .map((item) => ({
      kind: "conversation" as const,
      conversationId: item.id,
      title: item.title,
      roomId: item.room_id,
      roomName: roomNameFor(item.room_id, rooms),
      archived,
    }));
}

export function filterMessageMatches(
  conversations: LocalSearchConversation[],
  query: string,
  rooms: Map<string, string>,
  archived: boolean,
): ChatSearchMessageHit[] {
  const needle = query.toLowerCase();
  const hits: ChatSearchMessageHit[] = [];
  for (const conversation of conversations) {
    if (Boolean(conversation.archived_at) !== archived) continue;
    for (const message of conversation.messages ?? []) {
      if (message.status && message.status !== "complete") continue;
      const content = sanitizeSearchableContent(message.role, message.content);
      if (!content.toLowerCase().includes(needle)) continue;
      // Skip messages whose conversation title already contains the query when building message-only lists is not required;
      // both groups are shown separately, so keep the message hit.
      hits.push({
        kind: "message",
        conversationId: conversation.id,
        messageId: message.id,
        title: conversation.title,
        snippet: extractSnippet(content, query),
        role: message.role,
        roomId: conversation.room_id,
        roomName: roomNameFor(conversation.room_id, rooms),
        archived,
      });
    }
  }
  return hits;
}

/** Assemble a bounded, ordered payload: active titles, active messages, then archived. */
export function assembleSearchPayload(input: {
  query: string;
  titleHits: ChatSearchConversationHit[];
  messageHits: ChatSearchMessageHit[];
  messageSearchFailed?: boolean;
}): ChatSearchPayload {
  const query = input.query;
  const activeTitles = input.titleHits.filter((hit) => !hit.archived);
  const archivedTitles = input.titleHits.filter((hit) => hit.archived);
  const activeMessages = input.messageHits.filter((hit) => !hit.archived);
  const archivedMessages = input.messageHits.filter((hit) => hit.archived);

  const seenMessages = new Set<string>();
  const uniqueActiveMessages: ChatSearchMessageHit[] = [];
  for (const hit of activeMessages) {
    if (seenMessages.has(hit.messageId)) continue;
    seenMessages.add(hit.messageId);
    uniqueActiveMessages.push(hit);
  }

  const archived: ChatSearchHit[] = [];
  const seenArchivedConversations = new Set<string>();
  for (const hit of archivedMessages) {
    if (seenMessages.has(hit.messageId)) continue;
    seenMessages.add(hit.messageId);
    archived.push(hit);
    seenArchivedConversations.add(hit.conversationId);
  }
  for (const hit of archivedTitles) {
    if (seenArchivedConversations.has(hit.conversationId)) continue;
    seenArchivedConversations.add(hit.conversationId);
    archived.push(hit);
  }

  const titleBudget = Math.min(activeTitles.length, SEARCH_MAX_RESULTS);
  const conversations = activeTitles.slice(0, titleBudget);
  const remaining = SEARCH_MAX_RESULTS - conversations.length;
  const messages = uniqueActiveMessages.slice(0, Math.max(0, remaining));
  const archivedBudget = SEARCH_MAX_RESULTS - conversations.length - messages.length;
  return {
    query,
    conversations,
    messages,
    archived: archived.slice(0, Math.max(0, archivedBudget)),
    ...(input.messageSearchFailed ? { messageSearchFailed: true } : {}),
  };
}

/** Local (preview / fallback) search across already-loaded conversations. */
export function searchLocalConversations(
  conversations: LocalSearchConversation[],
  rooms: { id: string; name: string }[],
  rawQuery: unknown,
): ChatSearchPayload | null {
  const query = normalizeSearchQuery(rawQuery);
  if (!query || query.length < SEARCH_MIN_CHARS) return null;
  const roomMap = new Map(rooms.map((room) => [room.id, room.name]));
  const titleHits = [
    ...filterTitleMatches(conversations, query, roomMap, false),
    ...filterTitleMatches(conversations, query, roomMap, true),
  ];
  const messageHits = [
    ...filterMessageMatches(conversations, query, roomMap, false),
    ...filterMessageMatches(conversations, query, roomMap, true),
  ];
  return assembleSearchPayload({ query, titleHits, messageHits });
}

export type SearchMessageRow = {
  id: string;
  conversation_id: string;
  role: ChatSearchRole;
  content: string;
  created_at?: string | null;
};

export type SearchConversationRow = {
  id: string;
  title: string;
  room_id: string | null;
  archived_at: string | null;
  updated_at?: string | null;
};

/** Map owner-scoped DB rows into the client search payload. */
export function mapOwnedSearchRows(input: {
  query: string;
  conversations: SearchConversationRow[];
  messages: SearchMessageRow[];
  rooms: { id: string; name: string }[];
  messageSearchFailed?: boolean;
}): ChatSearchPayload {
  const roomMap = new Map(input.rooms.map((room) => [room.id, room.name]));
  const byId = new Map(input.conversations.map((row) => [row.id, row]));
  const titleHits: ChatSearchConversationHit[] = input.conversations
    .filter((row) => row.title.toLowerCase().includes(input.query.toLowerCase()))
    .map((row) => ({
      kind: "conversation" as const,
      conversationId: row.id,
      title: row.title,
      roomId: row.room_id,
      roomName: roomNameFor(row.room_id, roomMap),
      archived: Boolean(row.archived_at),
    }));

  const messageHits: ChatSearchMessageHit[] = [];
  for (const row of input.messages) {
    const conversation = byId.get(row.conversation_id);
    if (!conversation) continue;
    const content = sanitizeSearchableContent(row.role, row.content);
    if (!content.toLowerCase().includes(input.query.toLowerCase())) continue;
    messageHits.push({
      kind: "message",
      conversationId: conversation.id,
      messageId: row.id,
      title: conversation.title,
      snippet: extractSnippet(content, input.query),
      role: row.role,
      roomId: conversation.room_id,
      roomName: roomNameFor(conversation.room_id, roomMap),
      archived: Boolean(conversation.archived_at),
    });
  }

  return assembleSearchPayload({
    query: input.query,
    titleHits,
    messageHits,
    messageSearchFailed: input.messageSearchFailed,
  });
}
