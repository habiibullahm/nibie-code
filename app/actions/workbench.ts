"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { isTemporaryConversation } from "@/lib/chat/temporary";
import { canContinueInWorkbench } from "@/lib/workbench/offer";
import { workbenchTitleFromContent } from "@/lib/workbench/title";
import {
  workbenchVersionLimit,
  type WorkbenchVersion,
  type WorkbenchVersionSource,
  type WorkbenchVersionSummary,
} from "@/lib/workbench/types";
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

type VersionRow = {
  id: string;
  source: WorkbenchVersionSource;
  title: string;
  content: string;
  document_revision: number;
  revision_run_id: string | null;
  created_at: string;
};

const saveFailed = "We couldn't save that document. Please try again.";
const unavailable = "That document is no longer available.";
const conflictMessage = "This document changed elsewhere. Reload the latest version before saving.";
const responseUnavailable = "That response is no longer available.";
const responseNotReady = "Only a finished response can be opened in Workbench.";
const roomUnavailable = "That room is no longer available.";
const sessionFailed = "Your session has expired or the service is unavailable. Please try again.";
const versionUnavailable = "That version is no longer available.";
const versionsUnavailable = "Version history isn't available on this environment yet.";

const documentSelectWithRevision = "id,title,content,revision,room_id,created_at,updated_at";
const documentSelectWithoutRevision = "id,title,content,room_id,created_at,updated_at";
const versionSelect = "id,source,title,content,document_revision,revision_run_id,created_at";
const versionSummarySelect = "id,source,title,document_revision,created_at";

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

function asVersion(row: VersionRow): WorkbenchVersion {
  return {
    id: row.id,
    source: row.source === "ai" ? "ai" : "manual",
    title: row.title,
    content: row.content,
    document_revision: row.document_revision,
    revision_run_id: row.revision_run_id,
    created_at: row.created_at,
  };
}

function versionWriteFailure(error: { code?: string } | null): WorkbenchActionResult<never> | null {
  if (!error) return null;
  if (schemaUnavailable(error) || error.code === "PGRST202") return { error: versionsUnavailable };
  if (error.code === "PT409") return { error: conflictMessage, conflict: true };
  if (error.code === "PT404") return { error: versionUnavailable };
  if (error.code === "22023") return { error: "That suggestion is incomplete." };
  return failedWrite(error);
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
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("commit_workbench_version", {
      p_document_id: parsedId.data,
      p_expected_revision: parsed.data.expectedRevision,
      p_revision_run_id: runId.data,
      p_title: parsed.data.title,
      p_content: parsed.data.content,
    });
    const failure = versionWriteFailure(error);
    if (failure) return failure;
    if (!data?.document) return { error: saveFailed };
    return { data: withRevision(data.document as SavedDocumentRow) };
  } catch {
    return { error: sessionFailed };
  }
}

export async function createWorkbenchVersionAction(input: unknown): Promise<WorkbenchActionResult<WorkbenchVersion>> {
  const parsedId = validateWorkbenchId((input as { documentId?: unknown } | null)?.documentId);
  const expectedRevision = (input as { expectedRevision?: unknown } | null)?.expectedRevision;
  const revision = typeof expectedRevision === "number" && Number.isInteger(expectedRevision) && expectedRevision >= 1
    ? expectedRevision
    : null;
  if (!parsedId.success || revision == null) return { error: "Choose a valid document." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("commit_workbench_version", {
      p_document_id: parsedId.data,
      p_expected_revision: revision,
    });
    const failure = versionWriteFailure(error);
    if (failure) return failure;
    if (!data?.version) return { error: saveFailed };
    return { data: asVersion(data.version as VersionRow) };
  } catch {
    return { error: sessionFailed };
  }
}

export async function listWorkbenchVersionsAction(documentId: unknown): Promise<WorkbenchActionResult<WorkbenchVersionSummary[]>> {
  const parsedId = validateWorkbenchId(documentId);
  if (!parsedId.success) return { error: "Choose a valid document." };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data: document, error: documentError } = await supabase.from("workbench_documents")
      .select("id")
      .eq("id", parsedId.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (documentError) return { error: saveFailed };
    if (!document) return { error: unavailable };
    const { data, error } = await supabase.from("workbench_document_versions")
      .select(versionSummarySelect)
      .eq("user_id", user.id)
      .eq("document_id", parsedId.data)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(workbenchVersionLimit);
    if (schemaUnavailable(error)) return { error: versionsUnavailable };
    if (error) return { error: saveFailed };
    return {
      data: (data ?? []).map((row) => ({
        id: row.id as string,
        source: row.source === "ai" ? "ai" : "manual",
        title: row.title as string,
        document_revision: row.document_revision as number,
        created_at: row.created_at as string,
      })),
    };
  } catch {
    return { error: sessionFailed };
  }
}

export async function getWorkbenchVersionAction(input: unknown): Promise<WorkbenchActionResult<WorkbenchVersion>> {
  const documentId = validateWorkbenchId((input as { documentId?: unknown } | null)?.documentId);
  const versionId = validateWorkbenchId((input as { versionId?: unknown } | null)?.versionId);
  if (!documentId.success || !versionId.success) return { error: "Choose a valid document." };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("workbench_document_versions")
      .select(versionSelect)
      .eq("id", versionId.data)
      .eq("document_id", documentId.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (schemaUnavailable(error)) return { error: versionsUnavailable };
    if (error) return { error: saveFailed };
    if (!data) return { error: versionUnavailable };
    return { data: asVersion(data as VersionRow) };
  } catch {
    return { error: sessionFailed };
  }
}

export async function restoreWorkbenchVersionAction(input: unknown): Promise<WorkbenchActionResult<SavedDocument>> {
  const documentId = validateWorkbenchId((input as { documentId?: unknown } | null)?.documentId);
  const versionId = validateWorkbenchId((input as { versionId?: unknown } | null)?.versionId);
  const expectedRevision = (input as { expectedRevision?: unknown } | null)?.expectedRevision;
  const revision = typeof expectedRevision === "number" && Number.isInteger(expectedRevision) && expectedRevision >= 1
    ? expectedRevision
    : null;
  if (!documentId.success || !versionId.success || revision == null) return { error: "Choose a valid document." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.rpc("commit_workbench_version", {
      p_document_id: documentId.data,
      p_expected_revision: revision,
      p_version_id: versionId.data,
    });
    const failure = versionWriteFailure(error);
    if (failure) return failure;
    if (!data?.document) return { error: saveFailed };
    return { data: withRevision(data.document as SavedDocumentRow) };
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

const temporaryChatWorkbenchUnavailable = "A reply from a temporary chat can't be opened in Workbench.";

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
    const readConversation = (columns: string) => supabase
      .from("conversations")
      .select(columns)
      .eq("id", message.conversation_id)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; room_id: string | null; temporary_expires_at?: string | null }>();
    let { data: conversation, error: conversationError } = await readConversation("id,room_id,temporary_expires_at");
    // A database without temporary chats yet has none: read the ordinary columns.
    if (schemaUnavailable(conversationError)) ({ data: conversation, error: conversationError } = await readConversation("id,room_id"));
    if (conversationError) return { error: saveFailed };
    if (!conversation) return { error: responseUnavailable };
    // A Workbench document outlives its chat, so nothing from a temporary chat may be copied into one.
    if (isTemporaryConversation(conversation)) return { error: temporaryChatWorkbenchUnavailable };
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
