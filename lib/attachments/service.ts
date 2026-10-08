import "server-only";

import { randomUUID } from "node:crypto";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { extractAttachment } from "@/lib/attachments/extract";
import { CHAT_ATTACHMENTS_BUCKET, DRAFT_ATTACHMENT_TTL_MS, MAX_DRAFT_ATTACHMENTS, type AttachmentExtension } from "@/lib/attachments/limits";
import { attachmentErrors, attachmentName } from "@/lib/attachments/rules";
import { attachmentSummaryColumns, toAttachmentSummary, type AttachmentRow, type AttachmentSummary } from "@/lib/attachments/types";
import { operationalCodes } from "@/lib/observability/codes";
import { logError } from "@/lib/observability/logger";

type QueryError = { message?: string; code?: string } | null;
type Result<T> = { data: T; error: QueryError; count?: number | null };

type Query = PromiseLike<Result<unknown>> & {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => Query;
  eq: (column: string, value: string) => Query;
  is: (column: string, value: null) => Query;
  lt: (column: string, value: string) => Query;
  insert: (row: Record<string, unknown>) => Query;
  delete: () => Query;
  maybeSingle: () => PromiseLike<Result<Record<string, unknown> | null>>;
};

type StorageBucket = {
  upload: (path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }) => Promise<{ error: QueryError }>;
  remove: (paths: string[]) => Promise<{ data?: unknown; error: QueryError }>;
};

export type AttachmentClient = {
  from: (table: string) => Query;
  storage: { from: (bucket: string) => StorageBucket };
};

export const attachmentsUnavailable = "Attachments aren't available yet.";
export const tooManyDrafts = "You have too many unsent attachments. Remove some and try again.";

export function buildAttachmentStoragePath(ownerId: string, attachmentId: string, extension: AttachmentExtension) {
  // Server-generated path only: first folder is auth.uid() for Storage RLS.
  return `${ownerId}/attachments/${attachmentId}/${attachmentId}.${extension}`;
}

async function removeDurable(client: AttachmentClient, path: string) {
  await client.storage.from(CHAT_ATTACHMENTS_BUCKET).remove([path]).then(() => undefined, () => undefined);
}

/** Drop expired unsent drafts (DB + durable originals) for opportunistic cleanup. */
export async function purgeExpiredDraftAttachments(client: AttachmentClient, ownerId: string, now = Date.now()) {
  const listed = await client
    .from("message_attachments")
    .select("id,storage_path")
    .is("message_id", null)
    .lt("created_at", new Date(now - DRAFT_ATTACHMENT_TTL_MS).toISOString());
  const rows = (await Promise.resolve(listed).then((value) => value as Result<Array<{ id: string; storage_path: string | null }> | null>)).data ?? [];
  for (const row of rows) {
    if (row.storage_path?.startsWith(`${ownerId}/`)) await removeDurable(client, row.storage_path);
    await Promise.resolve(client.from("message_attachments").delete().eq("id", row.id)).then(() => undefined, () => undefined);
  }
}

// Extracts the file's text, stores original bytes in the durable private bucket, and saves an unlinked draft.
// Row-level security scopes every query to the signed-in owner; there is no service-role path.
export async function saveDraftAttachment(
  client: AttachmentClient,
  ownerId: string,
  file: { filename: string; mimeType: string; bytes: Uint8Array },
  now = Date.now(),
): Promise<{ data?: AttachmentSummary; error?: string }> {
  const extracted = await extractAttachment(file);
  if ("error" in extracted) return { error: extracted.error };
  const named = attachmentName(extracted.name);
  if ("error" in named) return { error: named.error };

  const table = () => client.from("message_attachments");
  await purgeExpiredDraftAttachments(client, ownerId, now);
  const counted = await table().select("id", { count: "exact", head: true }).is("message_id", null);
  if (schemaUnavailable(counted.error)) return { error: attachmentsUnavailable };
  if (counted.error) {
    logError("attachment.save.failed", { code: operationalCodes.attachmentSaveFailed, stage: "count" });
    return { error: attachmentErrors.saveFailed };
  }
  if ((counted.count ?? 0) >= MAX_DRAFT_ATTACHMENTS) return { error: tooManyDrafts };

  const attachmentId = randomUUID();
  const storagePath = buildAttachmentStoragePath(ownerId, attachmentId, named.extension);
  const uploaded = await client.storage.from(CHAT_ATTACHMENTS_BUCKET).upload(storagePath, file.bytes, {
    contentType: extracted.mimeType,
    upsert: false,
  });
  if (uploaded.error) {
    logError("attachment.save.failed", { code: operationalCodes.attachmentSaveFailed, stage: "upload" });
    return { error: attachmentErrors.saveFailed };
  }

  const inserted = await table().insert({
    id: attachmentId,
    user_id: ownerId,
    original_name: extracted.name,
    mime_type: extracted.mimeType,
    size_bytes: extracted.sizeBytes,
    storage_path: storagePath,
    extracted_text: extracted.text,
    truncated: extracted.truncated,
    page_count: extracted.pageCount,
  }).select(attachmentSummaryColumns).maybeSingle();
  if (schemaUnavailable(inserted.error)) {
    await removeDurable(client, storagePath);
    return { error: attachmentsUnavailable };
  }
  if (inserted.error || !inserted.data) {
    await removeDurable(client, storagePath);
    logError("attachment.save.failed", { code: operationalCodes.attachmentSaveFailed, stage: "insert" });
    return { error: attachmentErrors.saveFailed };
  }
  return { data: toAttachmentSummary(inserted.data as unknown as AttachmentRow) };
}

// Removes the owner's unsent draft and its durable original. A sent attachment stays with its message.
export async function deleteDraftAttachment(client: AttachmentClient, ownerId: string, attachmentId: string): Promise<{ error?: string }> {
  const loaded = await client
    .from("message_attachments")
    .select("id,storage_path")
    .eq("id", attachmentId)
    .is("message_id", null)
    .maybeSingle();
  if (loaded.error && !schemaUnavailable(loaded.error)) return { error: "We couldn't remove that attachment. Please try again." };
  const row = loaded.data as { id: string; storage_path: string | null } | null;
  if (!row) return {};
  if (row.storage_path?.startsWith(`${ownerId}/`)) await removeDurable(client, row.storage_path);
  const deleted = await client.from("message_attachments").delete().eq("id", attachmentId).is("message_id", null).select("id").maybeSingle();
  if (deleted.error && !schemaUnavailable(deleted.error)) return { error: "We couldn't remove that attachment. Please try again." };
  return {};
}
