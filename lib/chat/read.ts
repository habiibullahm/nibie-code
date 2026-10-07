import "server-only";
import { normalizeSavedMode } from "@/lib/chat/legacy-mode";

import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { attachmentSummaryColumns, toAttachmentSummary, type AttachmentRow, type AttachmentSummary } from "@/lib/attachments/types";
import { loadMessageSourcesByConversation } from "@/lib/citations/persist";
import type { CitationSourceView } from "@/lib/citations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { validateConversationId } from "@/lib/chat/validation";

export type ConversationSummary = {
  id: string;
  title: string;
  selected_model: string;
  room_id: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type RoomBriefSummary = {
  goal: string | null;
  current_focus: string | null;
  important_decisions: string | null;
  open_questions: string | null;
  next_step: string | null;
};

export type PinSummary = {
  id: string;
  room_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
  brief: RoomBriefSummary | null;
  pins: PinSummary[];
};
export type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  position: number;
  status?: "complete" | "streaming" | "interrupted" | "error";
  created_at?: string;
  terminationReason?: "user_stopped";
  attachments?: AttachmentSummary[];
  sources?: CitationSourceView[];
};

export async function getChatWorkspaceData(conversationId: unknown) {
  const supabase = await createSupabaseServerClient();
  const parsedId = validateConversationId(conversationId);
  const readMessages = (id: string) => supabase
    .from("messages")
    .select("id,role,content,position,status,created_at")
    .eq("conversation_id", id)
    .order("position", { ascending: true });
  const orderedConversations = (columns: string) => supabase
    .from("conversations")
    .select(columns)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });

  // The history list and the selected conversation's messages are independent reads, so they run together.
  // RLS scopes both to the signed-in owner; messages are only used when the conversation is in the owner's list.
  const [conversationResult, { data: roomRows, error: roomsError }, { data: briefRows, error: briefsError }, { data: pinRows, error: pinsError }, messagesResult, attachmentsResult, sourcesResult] = await Promise.all([
    orderedConversations("id,title,selected_model,room_id,archived_at,created_at,updated_at"),
    supabase
      .from("rooms")
      .select("id,name,description,instructions,created_at,updated_at")
      .order("name", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("room_briefs")
      .select("room_id,goal,current_focus,important_decisions,open_questions,next_step"),
    supabase
      .from("pins")
      .select("id,room_id,title,content,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true }),
    parsedId.success ? readMessages(parsedId.data) : Promise.resolve(null),
    // Metadata only: the extracted text of an attachment never goes to the browser.
    parsedId.success
      ? supabase.from("message_attachments").select(`${attachmentSummaryColumns},message_id,created_at`).eq("conversation_id", parsedId.data).order("created_at", { ascending: true })
      : Promise.resolve(null),
    parsedId.success
      ? loadMessageSourcesByConversation(supabase as Parameters<typeof loadMessageSourcesByConversation>[0], parsedId.data)
      : Promise.resolve({ byMessage: new Map<string, CitationSourceView[]>(), error: false, unavailable: true }),
  ]);
  const withoutArchive = schemaUnavailable(conversationResult.error)
    ? await orderedConversations("id,title,selected_model,room_id,created_at,updated_at")
    : null;
  const withoutRoom = withoutArchive && schemaUnavailable(withoutArchive.error)
    ? await orderedConversations("id,title,selected_model,created_at,updated_at")
    : null;
  const conversationRows = withoutRoom && !withoutRoom.error
    ? ((withoutRoom.data ?? []) as unknown as Omit<ConversationSummary, "room_id" | "archived_at">[]).map((row) => ({ ...row, room_id: null, archived_at: null }))
    : withoutArchive && !withoutArchive.error
      ? ((withoutArchive.data ?? []) as unknown as Omit<ConversationSummary, "archived_at">[]).map((row) => ({ ...row, archived_at: null }))
      : conversationResult.data;
  const conversationsError = withoutRoom ? withoutRoom.error : withoutArchive ? withoutArchive.error : conversationResult.error;
  const empty = { conversations: [] as ConversationSummary[], archivedConversations: [] as ConversationSummary[], rooms: [] as RoomSummary[], roomsError: null as string | null, messages: [] as PersistedMessage[], activeId: null };
  if (conversationsError) return { ...empty, error: "Conversation history couldn't be loaded. Refresh to try again." };
  // Saved modes from earlier builds ("Reasoning", display names) are normalized here, so the client only ever sees Fast / Balanced / High.
  const allConversations = ((conversationRows ?? []) as ConversationSummary[]).map((row) => ({ ...row, selected_model: normalizeSavedMode(row.selected_model) ?? row.selected_model, room_id: row.room_id ?? null, archived_at: row.archived_at ?? null }));
  const conversations = allConversations.filter((item) => !item.archived_at);
  const archivedConversations = allConversations.filter((item) => item.archived_at);
  const roomsMissing = schemaUnavailable(roomsError) || schemaUnavailable(briefsError);
  const briefs = new Map(roomsMissing ? [] : (briefRows ?? []).map((brief) => [brief.room_id, {
    goal: brief.goal,
    current_focus: brief.current_focus,
    important_decisions: brief.important_decisions,
    open_questions: brief.open_questions,
    next_step: brief.next_step,
  }]));
  const pinsMissing = roomsMissing || schemaUnavailable(pinsError);
  const pinsByRoom = new Map<string, PinSummary[]>();
  if (!pinsMissing) {
    for (const pin of pinRows ?? []) {
      const list = pinsByRoom.get(pin.room_id) ?? [];
      list.push(pin);
      pinsByRoom.set(pin.room_id, list);
    }
  }
  const rooms: RoomSummary[] = roomsMissing ? [] : (roomRows ?? []).map((room) => ({ ...room, brief: briefs.get(room.id) ?? null, pins: pinsByRoom.get(room.id) ?? [] }));
  const roomError = !roomsMissing && (roomsError || briefsError || (!pinsMissing && pinsError)) ? "Rooms couldn't be loaded. Refresh to try again." : null;

  const active = parsedId.success ? conversations.find((item) => item.id === parsedId.data) : undefined;
  if (!active || !messagesResult) return { conversations, archivedConversations, rooms, roomsError: roomError, messages: [] as PersistedMessage[], activeId: null, error: roomError };

  const loadError = { conversations, archivedConversations, rooms, roomsError: roomError, messages: [] as PersistedMessage[], activeId: active.id, error: "This conversation couldn't be loaded. Refresh to try again." };
  if (messagesResult.error) return loadError;
  let messages = messagesResult.data ?? [];

  // Stale-generation recovery takes a conversation lock and a write, so only pay for it when a response is actually marked streaming.
  if (messages.some((message) => message.status === "streaming")) {
    const { error: recoveryError } = await supabase.rpc("recover_stale_chat", { p_conversation_id: active.id });
    if (recoveryError) return loadError;
    const reread = await readMessages(active.id);
    if (reread.error) return loadError;
    messages = reread.data ?? [];
  }
  // A database without the attachments table yet has none; any other failed read keeps the thread from showing without them.
  if (attachmentsResult?.error && !schemaUnavailable(attachmentsResult.error)) return loadError;
  if (sourcesResult.error) return loadError;
  const byMessage = new Map<string, AttachmentSummary[]>();
  for (const row of (attachmentsResult?.error ? [] : attachmentsResult?.data ?? []) as unknown as (AttachmentRow & { message_id: string | null })[]) {
    if (!row.message_id) continue;
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), toAttachmentSummary(row)]);
  }
  return {
    conversations,
    archivedConversations,
    rooms,
    roomsError: roomError,
    messages: messages.map((message) => withSources(withAttachments(visibleMessage(message), byMessage), sourcesResult.byMessage)),
    activeId: active.id,
    error: roomError,
  };
}

function withAttachments<T extends { id: string }>(message: T, byMessage: Map<string, AttachmentSummary[]>): T & { attachments?: AttachmentSummary[] } {
  const attachments = byMessage.get(message.id);
  return attachments ? { ...message, attachments } : message;
}

function withSources<T extends { id: string }>(message: T, byMessage: Map<string, CitationSourceView[]>): T & { sources?: CitationSourceView[] } {
  const sources = byMessage.get(message.id);
  return sources?.length ? { ...message, sources } : message;
}

function visibleMessage<T extends { role: string; content: string }>(message: T): T {
  if (message.role !== "assistant") return message;
  return { ...message, content: sanitizeModelOutput(message.content).text };
}
