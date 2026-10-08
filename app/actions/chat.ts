"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { validateConversationId, validateMessage, validateTitle, type ChatModel } from "@/lib/chat/validation";
import { modelInputSchema } from "@/lib/chat/legacy-mode";
import { getModelOptions } from "@/lib/ai/registry";
import { logError, logInfo } from "@/lib/observability/logger";
import { operationalCodes } from "@/lib/observability/codes";
import { attachmentErrors, parseAttachmentIds } from "@/lib/attachments/rules";
import { parseStopRequest, parseStopRequests, stopDecision, stoppedContent, type StopRequest } from "@/lib/chat/stop";
import { parseChatRolePatch } from "@/lib/chat-roles/validation";
import { defaultChatRole, type ChatRole } from "@/lib/chat-roles/types";

export type ChatActionResult<T = undefined> = { data?: T; error?: string };
type ConversationRow = {
  id: string;
  title: string;
  selected_model: string;
  room_id: string | null;
  chat_role?: ChatRole;
  custom_instructions?: string | null;
  created_at: string;
  updated_at: string;
};
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

async function insertConversation(
  supabase: Supabase,
  userId: string,
  model: ChatModel,
  roomId: string | null,
  role: { chatRole: ChatRole; customInstructions: string | null } | null = null,
) {
  const wantsRole = Boolean(role && (role.chatRole !== defaultChatRole || role.customInstructions !== null));
  const roleFields = wantsRole && role
    ? { chat_role: role.chatRole, custom_instructions: role.customInstructions }
    : {};
  const inserted = await supabase.from("conversations").insert({
    user_id: userId,
    title: "New chat",
    selected_model: model,
    ...(roomId ? { room_id: roomId } : {}),
    ...roleFields,
  }).select("id,title,selected_model,room_id,chat_role,custom_instructions,created_at,updated_at").single();
  // Role columns missing while the user chose a non-default role: fail closed (do not silently start as General).
  if (schemaUnavailable(inserted.error) && wantsRole) return inserted;
  // A general thread does not need Rooms. Retry without room_id when that column is not in the database yet.
  if (!schemaUnavailable(inserted.error) || roomId) {
    if (inserted.data) {
      const row = inserted.data as ConversationRow;
      return {
        data: {
          ...row,
          chat_role: (row.chat_role as ChatRole | null | undefined) ?? role?.chatRole ?? defaultChatRole,
          custom_instructions: row.custom_instructions ?? role?.customInstructions ?? null,
        },
        error: null,
      };
    }
    return inserted;
  }
  const legacy = await supabase.from("conversations").insert({
    user_id: userId,
    title: "New chat",
    selected_model: model,
  }).select("id,title,selected_model,created_at,updated_at").single();
  if (legacy.error || !legacy.data) return legacy;
  return {
    data: {
      ...(legacy.data as unknown as Omit<ConversationRow, "room_id" | "chat_role" | "custom_instructions">),
      room_id: null,
      chat_role: defaultChatRole,
      custom_instructions: null,
    },
    error: null,
  };
}

// Applies explicit Stops: each reply keeps exactly the text its user saw and becomes interrupted.
// Only this owner's reply to the stopped user message is touched (RLS also scopes every query to the owner).
// The generation sees the interrupted row and stops itself; its late saves only apply while the row is still streaming.
async function stopReplies(supabase: Supabase, conversationId: string, stops: readonly StopRequest[]) {
  for (const stop of stops) {
    const owned = await supabase.from("messages").select("id").eq("id", stop.userMessageId).eq("conversation_id", conversationId).eq("role", "user").maybeSingle();
    if (owned.error || !owned.data) return false;
    // The row can change between the read and the guarded write (the stream finishing, or another Stop); read it again then.
    for (let attempt = 0; attempt < 3; attempt++) {
      let read = supabase.from("messages").select("id,status,content").eq("conversation_id", conversationId).eq("reply_to_message_id", stop.userMessageId).eq("role", "assistant");
      // A known reply id keeps a late Stop from reaching a newer reply to the same message (Retry after Stop).
      if (stop.assistantId) read = read.eq("id", stop.assistantId);
      const reply = await read.maybeSingle<{ id: string; status: string; content: string }>();
      if (reply.error) return false;
      // Nothing claimed yet: the claim cannot start once the next message is saved, and the stopped stream never reached the user.
      if (!reply.data || stopDecision(reply.data, stop.content) !== "write") break;
      const written = await supabase.from("messages").update({ status: "interrupted", content: stoppedContent(stop.content ?? "") })
        .eq("id", reply.data.id).eq("status", reply.data.status).select("id");
      if (written.error) return false;
      if (written.data?.length) {
        logInfo("chat.response.user_stopped", { reason: "user_stopped", status: "interrupted", previousStatus: reply.data.status });
        break;
      }
    }
  }
  return true;
}

export async function stopChatResponseAction(conversationId: unknown, userMessageId: unknown, assistantId: unknown = null, content: unknown = null): Promise<ChatActionResult> {
  const conversation = validateConversationId(conversationId);
  const stop = parseStopRequest(userMessageId, assistantId, content);
  if (!conversation.success || !stop) return { error: "Choose a valid message." };
  try {
    const { supabase } = await authenticatedClient();
    if (await stopReplies(supabase, conversation.data, [stop])) return {};
  } catch { /* report a safe background-persistence failure below */ }
  logError("chat.persistence.failed", { code: operationalCodes.assistantPersistFailed, reason: "user_stopped", stage: "stop" });
  return failure();
}

// The same message id makes the append idempotent, including the one allowed
// retry when a cancelled claim committed between the Stop and the append.
// With attachments, the message and its attachment links are saved in one transaction (see 0009_chat_attachments.sql).
async function appendMessage(supabase: Supabase, conversationId: string, messageId: string, content: string, stopped: readonly StopRequest[] = [], attachmentIds: readonly string[] = []): Promise<{ data: SavedMessage } | { error: string }> {
  if (stopped.length && !await stopReplies(supabase, conversationId, stopped)) return { error: saveFailed };
  const append = () => attachmentIds.length
    ? supabase.rpc("append_user_message_with_attachments", {
      p_conversation_id: conversationId, p_message_id: messageId, p_content: content, p_attachment_ids: [...attachmentIds],
    }).single<SavedMessage>()
    : supabase.rpc("append_user_message", {
      p_conversation_id: conversationId, p_message_id: messageId, p_content: content,
    }).single<SavedMessage>();
  let result = await append();
  if (result.error?.code === "PT409" && stopped.length && await stopReplies(supabase, conversationId, stopped)) result = await append();
  const { data, error } = result;
  if (attachmentIds.length) {
    if (error?.code === "PT409" && error.message === "Attachment unavailable.") return { error: attachmentErrors.unavailable };
    if (error?.code === "PT413") return { error: attachmentErrors.totalTooLarge };
    if (error?.code === "PT400") return { error: attachmentErrors.tooMany };
    if (error && schemaUnavailable(error)) return { error: "Attachments aren't available yet." };
  }
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

// The first message of a new chat: creates the conversation (including optional chat role) and saves the message
// in one round trip from the browser. If the message cannot be saved, the empty conversation is removed again.
export async function startConversationAction(
  model: unknown,
  messageId: unknown,
  content: unknown,
  roomId: unknown = null,
  attachmentIds: unknown = undefined,
  rolePatch: unknown = undefined,
): Promise<ChatActionResult<{ conversation: ConversationRow; message: SavedMessage }>> {
  const parsedAttachments = parseAttachmentIds(attachmentIds);
  if (!parsedAttachments.ok) return { error: attachmentErrors.tooMany };
  const parsedModel = modelInputSchema.safeParse(model);
  const parsedMessageId = validateConversationId(messageId);
  const parsedContent = validateMessage(content);
  const parsedRoom = roomId === null || roomId === undefined ? { success: true as const, data: null } : validateConversationId(roomId);
  const parsedRole = rolePatch === undefined || rolePatch === null
    ? { data: { chatRole: defaultChatRole, customInstructions: null as string | null } }
    : parseChatRolePatch(rolePatch);
  if (!parsedModel.success) return { error: "Choose a valid response mode." };
  if (!parsedMessageId.success) return { error: "Choose a valid message." };
  if (!parsedContent.success) return { error: "Messages must be between 1 and 20,000 characters." };
  if (!parsedRoom.success) return { error: "Choose a valid room." };
  if ("error" in parsedRole) return { error: parsedRole.error };
  if (!isModeAvailable(parsedModel.data)) return modelUnavailable;
  try {
    const { supabase, user } = await authenticatedClient();
    const { data: conversation, error } = await insertConversation(
      supabase,
      user.id,
      parsedModel.data,
      parsedRoom.data,
      parsedRole.data,
    );
    if (error?.code === "23503") return { error: "That room is no longer available." };
    if (schemaUnavailable(error) && (parsedRole.data.chatRole !== defaultChatRole || parsedRole.data.customInstructions !== null)) {
      return { error: "Chat roles aren't available yet on this workspace." };
    }
    if (error || !conversation) return failure();
    const saved = await appendMessage(supabase, conversation.id, parsedMessageId.data, parsedContent.data, [], parsedAttachments.ids);
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

/** Owner-scoped chat role + optional custom instructions. Never accepts client system/developer payloads. */
export async function updateConversationRoleAction(
  id: unknown,
  patch: unknown,
): Promise<ChatActionResult<{ chat_role: ChatRole; custom_instructions: string | null }>> {
  const parsedId = validateConversationId(id);
  const parsed = parseChatRolePatch(patch);
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  if ("error" in parsed) return { error: parsed.error };
  try {
    const { supabase } = await authenticatedClient();
    const updated = await supabase
      .from("conversations")
      .update({
        chat_role: parsed.data.chatRole,
        custom_instructions: parsed.data.customInstructions,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsedId.data)
      .select("id,chat_role,custom_instructions")
      .maybeSingle();
    if (schemaUnavailable(updated.error)) {
      return { error: "Chat roles aren't available yet on this workspace." };
    }
    if (updated.error) return failure();
    if (!updated.data) return { error: "That conversation is no longer available." };
    return {
      data: {
        chat_role: (updated.data.chat_role as ChatRole | null) ?? defaultChatRole,
        custom_instructions: (updated.data.custom_instructions as string | null) ?? null,
      },
    };
  } catch {
    return { error: "Your session has expired or the service is unavailable. Please try again." };
  }
}

export async function addUserMessageAction(id: unknown, content: unknown, messageId: unknown = crypto.randomUUID(), stoppedReplies: unknown = [], attachmentIds: unknown = undefined): Promise<ChatActionResult<SavedMessage>> {
  const parsedAttachments = parseAttachmentIds(attachmentIds);
  if (!parsedAttachments.ok) return { error: attachmentErrors.tooMany };
  const parsedId = validateConversationId(id);
  const parsedContent = validateMessage(content);
  const stopped = parseStopRequests(stoppedReplies);
  if (!stopped) return { error: "Choose a valid message." };
  if (!parsedId.success) return { error: "Choose a valid conversation." };
  if (!parsedContent.success) return { error: "Messages must be between 1 and 20,000 characters." };
  const parsedMessageId = validateConversationId(messageId);
  if (!parsedMessageId.success) return { error: "Choose a valid message." };
  try {
    const { supabase } = await authenticatedClient();
    const saved = await appendMessage(supabase, parsedId.data, parsedMessageId.data, parsedContent.data, stopped, parsedAttachments.ids);
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
