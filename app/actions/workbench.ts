"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { canContinueInWorkbench } from "@/lib/workbench/offer";
import { workbenchTitleFromContent } from "@/lib/workbench/title";
import { asWorkbenchDraft, parseWorkbenchCreate, parseWorkbenchWrite, validateWorkbenchId, workbenchCreateDefaults } from "@/lib/workbench/validation";

export type WorkbenchActionResult<T = undefined> = { data?: T; error?: string; conflict?: boolean };

type SavedDocument = {
  id: string;
  title: string;
  content: string;
  revision: number;
  room_id: string | null;
  created_at: string;
  updated_at: string;
};

type SavedDocumentRow = Omit<SavedDocument, "revision"> & { revision?: number | null };

const saveFailed = "We couldn't save that document. Please try again.";
const unavailable = "That document is no longer available.";
const conflictMessage = "This document changed elsewhere. Reload the latest version before saving.";
const responseUnavailable = "That response is no longer available.";
const responseNotReady = "Only a finished response can be opened in Workbench.";
const roomUnavailable = "That room is no longer available.";
const sessionFailed = "Your session has expired or the service is unavailable. Please try again.";

const documentSelectWithRevision = "id,title,content,revision,room_id,created_at,updated_at";
const documentSelectWithoutRevision = "id,title,content,room_id,created_at,updated_at";

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

function withRevision(row: SavedDocumentRow): SavedDocument {
  return {
    ...row,
    revision: typeof row.revision === "number" && row.revision >= 1 ? row.revision : 1,
  };
}

export async function createWorkbenchDocumentAction(input: unknown): Promise<WorkbenchActionResult<SavedDocument>> {
  const parsed = parseWorkbenchCreate(input);
  if ("error" in parsed) return { error: parsed.error };
  const draft = workbenchCreateDefaults(parsed.data);
  try {
    const { supabase, user } = await authenticatedClient();
    const row = {
      user_id: user.id,
      title: draft.title,
      content: draft.content,
      room_id: draft.roomId,
    };
    const primary = await supabase.from("workbench_documents").insert(row).select(documentSelectWithRevision).single();
    // Migration 0027 may be undeployed on Preview; create without returning revision.
    const result = schemaUnavailable(primary.error)
      ? await supabase.from("workbench_documents").insert(row).select(documentSelectWithoutRevision).single()
      : primary;
    const failure = failedWrite(result.error);
    if (failure) return failure;
    if (!result.data) return { error: saveFailed };
    return { data: withRevision(result.data as SavedDocumentRow) };
  } catch {
    return { error: sessionFailed };
  }
}

export async function updateWorkbenchDocumentAction(id: unknown, input: unknown): Promise<WorkbenchActionResult<SavedDocument>> {
  const parsedId = validateWorkbenchId(id);
  const parsed = parseWorkbenchWrite(input);
  if (!parsedId.success) return { error: "Choose a valid document." };
  if ("error" in parsed) return { error: parsed.error };
  const draft = asWorkbenchDraft(parsed.data);
  try {
    const { supabase, user } = await authenticatedClient();
    const primary = await supabase.from("workbench_documents").update({
      title: draft.title,
      content: draft.content,
      revision: parsed.data.expectedRevision + 1,
    }).eq("id", parsedId.data).eq("user_id", user.id).eq("revision", parsed.data.expectedRevision)
      .select(documentSelectWithRevision).maybeSingle();
    // Without revision CAS, last-write-wins keeps basic open/edit usable before migrate.
    const result = schemaUnavailable(primary.error)
      ? await supabase.from("workbench_documents").update({
        title: draft.title,
        content: draft.content,
      }).eq("id", parsedId.data).eq("user_id", user.id)
        .select(documentSelectWithoutRevision).maybeSingle()
      : primary;
    const failure = failedWrite(result.error);
    if (failure) return failure;
    if (!result.data) {
      const { data: existing } = await supabase.from("workbench_documents")
        .select("id")
        .eq("id", parsedId.data)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!existing) return { error: unavailable };
      return { error: conflictMessage, conflict: true };
    }
    return { data: withRevision(result.data as SavedDocumentRow) };
  } catch {
    return { error: sessionFailed };
  }
}

export async function applyWorkbenchSuggestionAction(input: unknown): Promise<WorkbenchActionResult<SavedDocument>> {
  const parsedId = validateWorkbenchId((input as { documentId?: unknown } | null)?.documentId);
  const parsed = parseWorkbenchWrite({
    title: (input as { title?: unknown } | null)?.title,
    content: (input as { content?: unknown } | null)?.content,
    expectedRevision: (input as { expectedRevision?: unknown } | null)?.expectedRevision,
  });
  const runId = validateWorkbenchId((input as { runId?: unknown } | null)?.runId);
  if (!parsedId.success || !runId.success) return { error: "Choose a valid document." };
  if ("error" in parsed) return { error: parsed.error };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data: run, error: runError } = await supabase.from("workbench_revision_runs")
      .select("id,status,proposed_title,proposed_content,base_revision,document_id")
      .eq("id", runId.data)
      .eq("user_id", user.id)
      .eq("document_id", parsedId.data)
      .maybeSingle();
    if (runError) return { error: saveFailed };
    if (!run || run.status !== "complete" || run.proposed_content == null) {
      return { error: "That suggestion is no longer available." };
    }
    if (run.proposed_content !== parsed.data.content || (run.proposed_title ?? parsed.data.title) !== parsed.data.title) {
      return { error: "That suggestion is incomplete." };
    }
    if (run.base_revision !== parsed.data.expectedRevision) {
      return { error: conflictMessage, conflict: true };
    }
    const result = await updateWorkbenchDocumentAction(parsedId.data, parsed.data);
    return result;
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
    const draft = parseWorkbenchWrite({
      title: workbenchTitleFromContent(visible),
      content: visible,
      expectedRevision: 1,
    });
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
