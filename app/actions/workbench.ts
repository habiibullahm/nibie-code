"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { canContinueInWorkbench } from "@/lib/workbench/offer";
import { workbenchTitleFromContent } from "@/lib/workbench/title";
import { parseWorkbenchCreate, parseWorkbenchWrite, validateWorkbenchId, workbenchCreateDefaults } from "@/lib/workbench/validation";

export type WorkbenchActionResult<T = undefined> = { data?: T; error?: string };

type SavedDocument = {
  id: string;
  title: string;
  content: string;
  room_id: string | null;
  created_at: string;
  updated_at: string;
};

const saveFailed = "We couldn't save that document. Please try again.";
const unavailable = "That document is no longer available.";
const responseUnavailable = "That response is no longer available.";
const responseNotReady = "Only a finished response can be opened in Workbench.";
const roomUnavailable = "That room is no longer available.";
const sessionFailed = "Your session has expired or the service is unavailable. Please try again.";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error(sessionFailed);
  return { supabase, user };
}

function failedWrite(error: { code?: string } | null): WorkbenchActionResult<never> | null {
  if (!error) return null;
  if (error.code === "23514") return { error: "That document text isn't valid." };
  if (error.code === "23503") return { error: roomUnavailable };
  return { error: saveFailed };
}

export async function createWorkbenchDocumentAction(input: unknown): Promise<WorkbenchActionResult<SavedDocument>> {
  const parsed = parseWorkbenchCreate(input);
  if ("error" in parsed) return { error: parsed.error };
  const draft = workbenchCreateDefaults(parsed.data);
  try {
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("workbench_documents").insert({
      user_id: user.id,
      title: draft.title,
      content: draft.content,
      room_id: draft.roomId,
    }).select("id,title,content,room_id,created_at,updated_at").single();
    const failure = failedWrite(error);
    if (failure) return failure;
    if (!data) return { error: saveFailed };
    return { data };
  } catch {
    return { error: sessionFailed };
  }
}

export async function updateWorkbenchDocumentAction(id: unknown, input: unknown): Promise<WorkbenchActionResult<SavedDocument>> {
  const parsedId = validateWorkbenchId(id);
  const parsed = parseWorkbenchWrite(input);
  if (!parsedId.success) return { error: "Choose a valid document." };
  if ("error" in parsed) return { error: parsed.error };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("workbench_documents").update({
      title: parsed.data.title,
      content: parsed.data.content,
    }).eq("id", parsedId.data).eq("user_id", user.id).select("id,title,content,room_id,created_at,updated_at").maybeSingle();
    const failure = failedWrite(error);
    if (failure) return failure;
    if (!data) return { error: unavailable };
    return { data };
  } catch {
    return { error: sessionFailed };
  }
}

export async function deleteWorkbenchDocumentAction(id: unknown): Promise<WorkbenchActionResult> {
  const parsedId = validateWorkbenchId(id);
  if (!parsedId.success) return { error: "Choose a valid document." };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("workbench_documents").delete().eq("id", parsedId.data).eq("user_id", user.id).select("id").maybeSingle();
    if (error) return { error: saveFailed };
    if (!data) return { error: unavailable };
    return {};
  } catch {
    return { error: sessionFailed };
  }
}

export async function createWorkbenchFromAssistantAction(messageId: unknown): Promise<WorkbenchActionResult<{ id: string }>> {
  const parsedId = validateWorkbenchId(messageId);
  if (!parsedId.success) return { error: responseUnavailable };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id,role,content,status,conversation_id")
      .eq("id", parsedId.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (messageError) return { error: saveFailed };
    if (!message) return { error: responseUnavailable };
    if (!canContinueInWorkbench(message)) return { error: responseNotReady };
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id,room_id")
      .eq("id", message.conversation_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (conversationError) return { error: saveFailed };
    if (!conversation) return { error: responseUnavailable };
    const visible = sanitizeModelOutput(message.content).text;
    if (!visible.trim()) return { error: responseNotReady };
    const draft = parseWorkbenchWrite({ title: workbenchTitleFromContent(visible), content: visible });
    if ("error" in draft) return { error: draft.error };
    const { data, error } = await supabase.from("workbench_documents").insert({
      user_id: user.id,
      title: draft.data.title,
      content: draft.data.content,
      room_id: conversation.room_id,
    }).select("id").single();
    const failure = failedWrite(error);
    if (failure) return failure;
    if (!data) return { error: saveFailed };
    return { data: { id: data.id } };
  } catch {
    return { error: sessionFailed };
  }
}
