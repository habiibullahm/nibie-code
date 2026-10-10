"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { canContinueInWorkbench } from "@/lib/workbench/offer";
import { workbenchTitleFromContent } from "@/lib/workbench/title";
import {
  workbenchVersionLimit,
  type WorkbenchVersion,
  type WorkbenchVersionSource,
  type WorkbenchVersionSummary,
} from "@/lib/workbench/types";
import { asWorkbenchDraft, parseWorkbenchCreate, parseWorkbenchWrite, validateWorkbenchId, workbenchCreateDefaults } from "@/lib/workbench/validation";
import { shouldSkipDuplicateVersion, versionIdsToPrune } from "@/lib/workbench/versions";

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

async function pruneDocumentVersions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  documentId: string,
) {
  const { data, error } = await supabase
    .from("workbench_document_versions")
    .select("id")
    .eq("user_id", userId)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  if (error || !data) return;
  const prune = versionIdsToPrune(data.map((row) => row.id as string), workbenchVersionLimit);
  if (prune.length === 0) return;
  await supabase.from("workbench_document_versions").delete().eq("user_id", userId).in("id", prune);
}

async function insertDocumentVersion(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  documentId: string,
  input: {
    source: WorkbenchVersionSource;
    title: string;
    content: string;
    documentRevision: number;
    revisionRunId?: string | null;
  },
): Promise<WorkbenchActionResult<WorkbenchVersion>> {
  const { data: latest, error: latestError } = await supabase
    .from("workbench_document_versions")
    .select("title,content")
    .eq("user_id", userId)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    if (schemaUnavailable(latestError)) return { error: versionsUnavailable };
    return { error: saveFailed };
  }
  if (shouldSkipDuplicateVersion(latest, input)) {
    const { data: existing } = await supabase
      .from("workbench_document_versions")
      .select(versionSelect)
      .eq("user_id", userId)
      .eq("document_id", documentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { data: asVersion(existing as VersionRow) };
  }
  const insert = await supabase.from("workbench_document_versions").insert({
    user_id: userId,
    document_id: documentId,
    source: input.source,
    title: input.title,
    content: input.content,
    document_revision: input.documentRevision,
    revision_run_id: input.revisionRunId ?? null,
  }).select(versionSelect).single();
  if (schemaUnavailable(insert.error)) return { error: versionsUnavailable };
  const failure = failedWrite(insert.error);
  if (failure) return failure;
  if (!insert.data) return { error: saveFailed };
  await pruneDocumentVersions(supabase, userId, documentId);
  return { data: asVersion(insert.data as VersionRow) };
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
      .select("id,status,proposed_title,proposed_content,base_revision,base_title,base_content,document_id")
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
    // Snapshot the pre-apply document so restore can undo the AI edit; ignore version migrate lag.
    await insertDocumentVersion(supabase, user.id, parsedId.data, {
      source: "ai",
      title: run.base_title,
      content: run.base_content,
      documentRevision: run.base_revision,
      revisionRunId: run.id,
    });
    const result = await updateWorkbenchDocumentAction(parsedId.data, parsed.data);
    return result;
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
    const { supabase, user } = await authenticatedClient();
    const { data: document, error } = await supabase.from("workbench_documents")
      .select("id,title,content,revision")
      .eq("id", parsedId.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return { error: saveFailed };
    if (!document) return { error: unavailable };
    if (document.revision !== revision) return { error: conflictMessage, conflict: true };
    return insertDocumentVersion(supabase, user.id, parsedId.data, {
      source: "manual",
      title: document.title,
      content: document.content,
      documentRevision: document.revision,
    });
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
      .order("created_at", { ascending: false })
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
    const { supabase, user } = await authenticatedClient();
    const { data: version, error: versionError } = await supabase.from("workbench_document_versions")
      .select(versionSelect)
      .eq("id", versionId.data)
      .eq("document_id", documentId.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (schemaUnavailable(versionError)) return { error: versionsUnavailable };
    if (versionError) return { error: saveFailed };
    if (!version) return { error: versionUnavailable };
    const { data: document, error: documentError } = await supabase.from("workbench_documents")
      .select(documentSelectWithRevision)
      .eq("id", documentId.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (documentError) {
      if (schemaUnavailable(documentError)) return { error: conflictMessage, conflict: true };
      return { error: saveFailed };
    }
    if (!document) return { error: unavailable };
    const current = withRevision(document as SavedDocumentRow);
    if (current.revision !== revision) return { error: conflictMessage, conflict: true };
    if (current.title === version.title && current.content === version.content) {
      return { data: current };
    }
    // Keep current text recoverable before overwriting with the selected snapshot.
    await insertDocumentVersion(supabase, user.id, documentId.data, {
      source: "manual",
      title: current.title,
      content: current.content,
      documentRevision: current.revision,
    });
    return updateWorkbenchDocumentAction(documentId.data, {
      title: version.title,
      content: version.content,
      expectedRevision: revision,
    });
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
