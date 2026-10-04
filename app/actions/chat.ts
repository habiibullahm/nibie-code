"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { validateConversationId, validateMessage, validateTitle, type ChatModel } from "@/lib/chat/validation";
import { modelInputSchema } from "@/lib/chat/legacy-mode";
import { getModelOptions } from "@/lib/ai/registry";
import { logError, logInfo } from "@/lib/observability/logger";
import { operationalCodes } from "@/lib/observability/codes";

export type ChatActionResult<T = undefined> = { data?: T; error?: string };
type ConversationRow = { id: string; title: string; selected_model: string; room_id: string | null; created_at: string; updated_at: string };
type SavedMessage = { id: string; position: number };
type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// The session is verified from the access token (no Auth round trip); every query below is still scoped to its owner by RLS.
async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  return { supabase, user };
}

// A mode can only be saved when the server has a model configured for it.
const modelUnavailable = { error: "That model isn't available." };
const isModeAvailable = (mode: ChatModel) => getModelOptions().models.some((option) => option.id === mode);

const saveFailed = "We couldn't save that change. Please try again.";
function failure<T>(): ChatActionResult<T> {
  return { error: saveFailed };
}

async function insertConversation(supabase: Supabase, userId: string, model: ChatModel, roomId: string | null) {
  const inserted = await supabase.from("conversations").insert({
    user_id: userId,
    title: "New chat",
    selected_model: model,
    ...(roomId ? { room_id: roomId } : {}),
  }).select("id,title,selected_model,room_id,created_at,updated_at").single();
  // A general thread does not need Rooms. Retry without room_id when that column is not in the database yet.
  if (!schemaUnavailable(inserted.error) || roomId) return inserted;
  const legacy = await supabase.from("conversations").insert({
    user_id: userId,
    title: "New chat",
    selected_model: model,
  }).select("id,title,selected_model,created_at,updated_at").single();
  if (legacy.error || !legacy.data) return legacy;
  return { data: { ...(legacy.data as unknown as Omit<ConversationRow, "room_id">), room_id: null }, error: null };
}

function parseStoppedReplies(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const ids: string[] = [];
  for (const id of value) {
    const parsed = validateConversationId(id);
    if (!parsed.success) return null;
    ids.push(parsed.data);
  }
  return [...new Set(ids)];
}

// Retire only this owner's reply to the explicitly stopped user message.
// No content is written here: the original stream owns that one final save.
async function retireStoppedReplies(supabase: Supabase, conversationId: string, ids: readonly string[]) {
  for (const id of ids) {
    const owned = await supabase.from("messages").select("id").eq("id", id).eq("conversation_id", conversationId).eq("role", "user").maybeSingle();
    if (owned.error || !owned.data) return false;
    const retired = await supabase.from("messages").update({ status: "interrupted" })
      .eq("conversation_id", conversationId).eq("reply_to_message_id", id).eq("role", "assistant").eq("status", "streaming").select("id");
    if (retired.error) return false;
    if (retired.data?.length) logInfo("chat.response.user_stopped", { reason: "user_stopped", status: "interrupted" });
  }
  return true;
}

export async function stopChatResponseAction(conversationId: unknown, userMessageId: unknown): Promise<ChatActionResult> {
  const conversation = validateConversationId(conversationId);
  const message = validateConversationId(userMessageId);
  if (!conversation.success || !message.success) return { error: "Choose a valid message." };
  try {
    const { supabase } = await authenticatedClient();
    if (await retireStoppedReplies(supabase, conversation.data, [message.data])) return {};
  } catch { /* report a safe background-persistence failure below */ }
  logError("chat.persistence.failed", { code: operationalCodes.assistantPersistFailed, reason: "user_stopped", stage: "stop" });
  return failure();
}

// The same message id makes the append idempotent, including the one allowed
// retry when a cancelled claim committed between stop retirement and append.
async function appendMessage(supabase: Supabase, conversationId: string, messageId: string, content: string, stopped: readonly string[] = []): Promise<{ data: SavedMessage } | { error: string }> {
  if (stopped.length && !await retireStoppedReplies(supabase, conversationId, stopped)) return { error: saveFailed };
  const append = () => supabase.rpc("append_user_message", {
    p_conversation_id: conversationId, p_message_id: messageId, p_content: content,
  }).single<SavedMessage>();
  let result = await append();
  if (result.error?.code === "PT409" && stopped.length && await retireStoppedReplies(supabase, conversationId, stopped)) result = await append();
  const { data, error } = result;
  if (error?.code === "PT409") return { error: "A response is already running or this submission changed. Refresh and try again." };
  if (error?.code === "PT404") return { error: "That conversation is no longer available." };
  if (error || !data) return { error: saveFailed };
  return { data };
}

export async function createConversationAction(model: unknown): Promise<ChatActionResult<ConversationRow>> {
  const parsedModel = modelInputSchema.safeParse(model);
  if (!parsedModel.success) return { error: "Choose a valid response mode." };
  if (!isModeAvailable(parsedModel.data)) return modelUnavailable;
  try {
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await insertConversation(supabase, user.id, parsedModel.data, null);
    if (error || !data) return failure();
    return { data };
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

// The first message of a new chat: creates the conversation and saves the message in one round trip from the browser.
// If the message cannot be saved, the empty conversation is removed again so history is not left with a blank "New chat".
export async function startConversationAction(model: unknown, messageId: unknown, content: unknown, roomId: unknown = null): Promise<ChatActionResult<{ conversation: ConversationRow; message: SavedMessage }>> {
  const parsedModel = modelInputSchema.safeParse(model);
  const parsedMessageId = validateConversationId(messageId);
  const parsedContent = validateMessage(content);
  const parsedRoom = roomId === null || roomId === undefined ? { success: true as const, data: null } : validateConversationId(roomId);
  if (!parsedModel.success) return { error: "Choose a valid response mode." };
  if (!parsedMessageId.success) return { error: "Choose a valid message." };
  if (!parsedContent.success) return { error: "Messages must be between 1 and 20,000 characters." };
  if (!parsedRoom.success) return { error: "Choose a valid room." };
  if (!isModeAvailable(parsedModel.data)) return modelUnavailable;
  try {
    const { supabase, user } = await authenticatedClient();
    const { data: conversation, error } = await insertConversation(supabase, user.id, parsedModel.data, parsedRoom.data);
    if (error?.code === "23503") return { error: "That room is no longer available." };
    if (error || !conversation) return failure();
    const saved = await appendMessage(supabase, conversation.id, parsedMessageId.data, parsedContent.data);
    if ("error" in saved) {
      await supabase.from("conversations").delete().eq("id", conversation.id).then(() => undefined, () => undefined);
      return { error: saved.error };
    }
    return { data: { conversation, message: saved.data } };
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function updateConversationModelAction(id: unknown, model: unknown): Promise<ChatActionResult> {
  const parsedId = validateConversationId(id);
  const parsedModel = modelInputSchema.safeParse(model);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  if (!parsedModel.success) return { error: "Choose a valid response mode." };
  if (!isModeAvailable(parsedModel.data)) return modelUnavailable;
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("conversations").update({ selected_model: parsedModel.data, updated_at: new Date().toISOString() }).eq("id", parsedId.data).select("id").maybeSingle();
    if (error) return failure();
    if (!data) return { error: "That conversation is no longer available." };
    return {};
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function addUserMessageAction(id: unknown, content: unknown, messageId: unknown = crypto.randomUUID(), stoppedReplies: unknown = []): Promise<ChatActionResult<SavedMessage>> {
  const parsedId = validateConversationId(id);
  const parsedContent = validateMessage(content);
  const stopped = parseStoppedReplies(stoppedReplies);
  if (!stopped) return { error: "Choose a valid message." };
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  if (!parsedContent.success) return { error: "Messages must be between 1 and 20,000 characters." };
  const parsedMessageId = validateConversationId(messageId);
  if (!parsedMessageId.success) return { error: "Choose a valid message." };
  try {
    const { supabase } = await authenticatedClient();
    const saved = await appendMessage(supabase, parsedId.data, parsedMessageId.data, parsedContent.data, stopped);
    return "error" in saved ? { error: saved.error } : { data: saved.data };
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function editLastUserMessageAction(id: unknown, messageId: unknown, content: unknown): Promise<ChatActionResult<SavedMessage>> {
  const parsedId = validateConversationId(id);
  const parsedMessageId = validateConversationId(messageId);
  const parsedContent = validateMessage(content);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  if (!parsedMessageId.success) return { error: "Choose a valid message." };
  if (!parsedContent.success) return { error: "Messages must be between 1 and 20,000 characters." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("edit_last_user_message", {
      p_conversation_id: parsedId.data, p_message_id: parsedMessageId.data, p_content: parsedContent.data,
    }).single<SavedMessage>();
    if (error?.code === "PT409") return { error: "Only the latest message can be edited while no response is running. Refresh and try again." };
    if (error?.code === "PT404") return { error: "That message is no longer available." };
    if (error || !data) return failure();
    return { data };
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function renameConversationAction(id: unknown, title: unknown): Promise<ChatActionResult> {
  const parsedId = validateConversationId(id);
  const parsedTitle = validateTitle(title);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  if (!parsedTitle.success) return { error: "Titles must be between 1 and 120 characters." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("conversations").update({ title: parsedTitle.data, updated_at: new Date().toISOString() }).eq("id", parsedId.data).select("id").maybeSingle();
    if (error) return failure();
    if (!data) return { error: "That conversation is no longer available." };
    return {};
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function moveConversationAction(id: unknown, roomId: unknown): Promise<ChatActionResult> {
  const parsedId = validateConversationId(id);
  const parsedRoom = roomId === null ? { success: true as const, data: null } : validateConversationId(roomId);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  if (!parsedRoom.success) return { error: "Choose a valid room." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("conversations").update({ room_id: parsedRoom.data, updated_at: new Date().toISOString() }).eq("id", parsedId.data).select("id").maybeSingle();
    if (error?.code === "23503") return { error: "That room is no longer available." };
    if (error) return failure();
    if (!data) return { error: "That conversation is no longer available." };
    return {};
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function deleteConversationAction(id: unknown): Promise<ChatActionResult> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("conversations").delete().eq("id", parsedId.data).select("id").maybeSingle();
    if (error) return failure();
    if (!data) return { error: "That conversation is no longer available." };
    return {};
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function archiveConversationAction(id: unknown): Promise<ChatActionResult> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("conversations").update({ archived_at: new Date().toISOString() }).eq("id", parsedId.data).is("archived_at", null).select("id").maybeSingle();
    if (error) return failure();
    if (!data) return { error: "That conversation is no longer available." };
    return {};
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function restoreConversationAction(id: unknown): Promise<ChatActionResult> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("conversations").update({ archived_at: null }).eq("id", parsedId.data).not("archived_at", "is", null).select("id").maybeSingle();
    if (error) return failure();
    if (!data) return { error: "That archived conversation is no longer available." };
    return {};
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}
