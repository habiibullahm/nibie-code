import "server-only";

import { randomUUID } from "node:crypto";
import { ATTACHMENT_TYPES, ATTACHMENT_UPLOAD_SESSION_TTL_MS, CHAT_ATTACHMENT_UPLOADS_BUCKET, DRAFT_ATTACHMENT_TTL_MS, MAX_ATTACHMENT_BYTES, MAX_DRAFT_ATTACHMENTS, type AttachmentExtension } from "@/lib/attachments/limits";
import { attachmentErrors, attachmentName, checkAttachmentFile } from "@/lib/attachments/rules";
import { attachmentsUnavailable, saveDraftAttachment, tooManyDrafts, type AttachmentClient } from "@/lib/attachments/service";
import type { AttachmentSummary } from "@/lib/attachments/types";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { operationalCodes } from "@/lib/observability/codes";
import { logError } from "@/lib/observability/logger";

type QueryError = { message?: string; code?: string } | null;
type Result<T> = { data: T; error: QueryError; count?: number | null };

type SessionQuery = PromiseLike<Result<unknown>> & {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => SessionQuery;
  eq: (column: string, value: string) => SessionQuery;
  lt: (column: string, value: string) => SessionQuery;
  insert: (row: Record<string, unknown>) => SessionQuery;
  delete: () => SessionQuery;
  maybeSingle: () => PromiseLike<Result<Record<string, unknown> | null>>;
};

type StorageBucket = {
  createSignedUploadUrl: (path: string) => Promise<{ data: { signedUrl: string; token: string; path: string } | null; error: QueryError }>;
  download: (path: string) => Promise<{ data: Blob | null; error: QueryError }>;
  remove: (paths: string[]) => Promise<{ data: unknown; error: QueryError }>;
};

export type AttachmentUploadClient = AttachmentClient & {
  storage: { from: (bucket: string) => StorageBucket };
};

export type UploadSessionTicket = {
  uploadId: string;
  path: string;
  token: string;
  signedUrl: string;
  contentType: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  declared_size: number;
  expires_at: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessions(client: AttachmentUploadClient) {
  return client.from("attachment_upload_sessions") as unknown as SessionQuery;
}

function buildStagingPath(ownerId: string, uploadId: string, extension: AttachmentExtension) {
  return `${ownerId}/drafts/${uploadId}/${uploadId}.${extension}`;
}

async function removeStaging(client: AttachmentUploadClient, path: string) {
  await client.storage.from(CHAT_ATTACHMENT_UPLOADS_BUCKET).remove([path]).then(() => undefined, () => undefined);
}

async function cleanupExpiredSessions(client: AttachmentUploadClient, ownerId: string, now: number) {
  const expired = await sessions(client)
    .select("id,storage_path")
    .eq("user_id", ownerId)
    .lt("expires_at", new Date(now).toISOString());
  const rows = (await Promise.resolve(expired).then((value) => value as Result<Array<{ id: string; storage_path: string }> | null>)).data ?? [];
  for (const row of rows) {
    await removeStaging(client, row.storage_path);
    await Promise.resolve(sessions(client).delete().eq("id", row.id)).then(() => undefined, () => undefined);
  }
  // Abandoned extracted drafts stay on the existing TTL path in saveDraftAttachment.
  await Promise.resolve(
    client.from("message_attachments").delete().is("message_id", null).lt("created_at", new Date(now - DRAFT_ATTACHMENT_TTL_MS).toISOString()),
  ).then(() => undefined, () => undefined);
}

export async function createAttachmentUploadSession(
  client: AttachmentUploadClient,
  ownerId: string,
  file: { name: string; size: number; type: string },
  now = Date.now(),
): Promise<{ data?: UploadSessionTicket; error?: string }> {
  const checked = checkAttachmentFile(file);
  if ("error" in checked) return { error: checked.error };

  await cleanupExpiredSessions(client, ownerId, now);

  const draftCount = await client.from("message_attachments").select("id", { count: "exact", head: true }).is("message_id", null);
  if (schemaUnavailable(draftCount.error)) return { error: attachmentsUnavailable };
  if (draftCount.error) {
    logError("attachment.session.failed", { code: operationalCodes.attachmentSaveFailed, stage: "count" });
    return { error: attachmentErrors.saveFailed };
  }
  if ((draftCount.count ?? 0) >= MAX_DRAFT_ATTACHMENTS) return { error: tooManyDrafts };

  const uploadId = randomUUID();
  const path = buildStagingPath(ownerId, uploadId, checked.extension);
  const mimeType = ATTACHMENT_TYPES[checked.extension].mime;
  const expiresAt = new Date(now + ATTACHMENT_UPLOAD_SESSION_TTL_MS).toISOString();

  const inserted = await sessions(client).insert({
    id: uploadId,
    user_id: ownerId,
    storage_path: path,
    original_name: checked.name,
    mime_type: mimeType,
    declared_size: file.size,
    expires_at: expiresAt,
  }).select("id").maybeSingle();
  if (schemaUnavailable(inserted.error)) return { error: attachmentsUnavailable };
  if (inserted.error || !inserted.data) {
    logError("attachment.session.failed", { code: operationalCodes.attachmentSaveFailed, stage: "insert" });
    return { error: attachmentErrors.saveFailed };
  }

  const signed = await client.storage.from(CHAT_ATTACHMENT_UPLOADS_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.signedUrl || !signed.data.token) {
    await Promise.resolve(sessions(client).delete().eq("id", uploadId)).then(() => undefined, () => undefined);
    logError("attachment.session.failed", { code: operationalCodes.attachmentSaveFailed, stage: "sign" });
    return { error: attachmentErrors.saveFailed };
  }

  return {
    data: {
      uploadId,
      path: signed.data.path || path,
      token: signed.data.token,
      signedUrl: signed.data.signedUrl,
      contentType: mimeType,
    },
  };
}

export async function confirmAttachmentUpload(
  client: AttachmentUploadClient,
  ownerId: string,
  uploadId: string,
  now = Date.now(),
): Promise<{ data?: AttachmentSummary; error?: string }> {
  if (!uuidPattern.test(uploadId)) return { error: attachmentErrors.saveFailed };

  const loaded = await sessions(client).select("id,user_id,storage_path,original_name,mime_type,declared_size,expires_at").eq("id", uploadId).maybeSingle();
  if (schemaUnavailable(loaded.error)) return { error: attachmentsUnavailable };
  if (loaded.error) {
    logError("attachment.confirm.failed", { code: operationalCodes.attachmentSaveFailed, stage: "session" });
    return { error: attachmentErrors.saveFailed };
  }
  const session = loaded.data as SessionRow | null;
  if (!session || session.user_id !== ownerId) return { error: attachmentErrors.unavailable };
  if (Date.parse(session.expires_at) <= now) {
    await removeStaging(client, session.storage_path);
    await Promise.resolve(sessions(client).delete().eq("id", uploadId)).then(() => undefined, () => undefined);
    return { error: attachmentErrors.unavailable };
  }
  if (!session.storage_path.startsWith(`${ownerId}/`)) {
    await Promise.resolve(sessions(client).delete().eq("id", uploadId)).then(() => undefined, () => undefined);
    return { error: attachmentErrors.saveFailed };
  }

  const downloaded = await client.storage.from(CHAT_ATTACHMENT_UPLOADS_BUCKET).download(session.storage_path);
  if (downloaded.error || !downloaded.data) {
    await Promise.resolve(sessions(client).delete().eq("id", uploadId)).then(() => undefined, () => undefined);
    return { error: attachmentErrors.unavailable };
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  // Always drop staging bytes after read (success and failure).
  await removeStaging(client, session.storage_path);
  await Promise.resolve(sessions(client).delete().eq("id", uploadId)).then(() => undefined, () => undefined);

  if (bytes.byteLength <= 0) return { error: attachmentErrors.empty };
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { error: attachmentErrors.tooLarge };
  if (bytes.byteLength !== session.declared_size) return { error: attachmentErrors.saveFailed };

  const named = attachmentName(session.original_name);
  if ("error" in named) return { error: named.error };

  return saveDraftAttachment(client, ownerId, {
    filename: session.original_name,
    mimeType: session.mime_type,
    bytes,
  }, now);
}

export async function abortAttachmentUpload(client: AttachmentUploadClient, ownerId: string, uploadId: string): Promise<{ error?: string }> {
  if (!uuidPattern.test(uploadId)) return { error: attachmentErrors.saveFailed };
  const loaded = await sessions(client).select("id,user_id,storage_path").eq("id", uploadId).maybeSingle();
  if (loaded.error && !schemaUnavailable(loaded.error)) return { error: attachmentErrors.saveFailed };
  const session = loaded.data as Pick<SessionRow, "id" | "user_id" | "storage_path"> | null;
  if (!session || session.user_id !== ownerId) return {};
  await removeStaging(client, session.storage_path);
  await Promise.resolve(sessions(client).delete().eq("id", uploadId)).then(() => undefined, () => undefined);
  return {};
}
