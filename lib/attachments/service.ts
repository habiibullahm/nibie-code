import "server-only";

import { schemaUnavailable } from "@/lib/chat/schema-error";
import { extractAttachment } from "@/lib/attachments/extract";
import { DRAFT_ATTACHMENT_TTL_MS, MAX_DRAFT_ATTACHMENTS } from "@/lib/attachments/limits";
import { attachmentErrors } from "@/lib/attachments/rules";
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

export type AttachmentClient = { from: (table: string) => Query };

export const attachmentsUnavailable = "Attachments aren't available yet.";
export const tooManyDrafts = "You have too many unsent attachments. Remove some and try again.";

// Extracts the file's text and saves it as an unlinked draft of the signed-in owner. Row-level security scopes every
// query to that owner; the original bytes are not kept.
export async function saveDraftAttachment(client: AttachmentClient, ownerId: string, file: { filename: string; mimeType: string; bytes: Uint8Array }, now = Date.now()): Promise<{ data?: AttachmentSummary; error?: string }> {
  const extracted = await extractAttachment(file);
  if ("error" in extracted) return { error: extracted.error };
  const table = () => client.from("message_attachments");
  // Abandoned drafts are removed opportunistically; a failure here never blocks the new upload.
  await Promise.resolve(table().delete().is("message_id", null).lt("created_at", new Date(now - DRAFT_ATTACHMENT_TTL_MS).toISOString())).then(() => undefined, () => undefined);
  const counted = await table().select("id", { count: "exact", head: true }).is("message_id", null);
  if (schemaUnavailable(counted.error)) return { error: attachmentsUnavailable };
  if (counted.error) {
    logError("attachment.save.failed", { code: operationalCodes.attachmentSaveFailed, stage: "count" });
    return { error: attachmentErrors.saveFailed };
  }
  if ((counted.count ?? 0) >= MAX_DRAFT_ATTACHMENTS) return { error: tooManyDrafts };
  const inserted = await table().insert({
    user_id: ownerId,
    original_name: extracted.name,
    mime_type: extracted.mimeType,
    size_bytes: extracted.sizeBytes,
    extracted_text: extracted.text,
    truncated: extracted.truncated,
    page_count: extracted.pageCount,
  }).select(attachmentSummaryColumns).maybeSingle();
  if (schemaUnavailable(inserted.error)) return { error: attachmentsUnavailable };
  if (inserted.error || !inserted.data) {
    logError("attachment.save.failed", { code: operationalCodes.attachmentSaveFailed, stage: "insert" });
    return { error: attachmentErrors.saveFailed };
  }
  return { data: toAttachmentSummary(inserted.data as unknown as AttachmentRow) };
}

// Removes the owner's unsent draft. A sent attachment stays with its message, and a missing draft is already gone.
export async function deleteDraftAttachment(client: AttachmentClient, attachmentId: string): Promise<{ error?: string }> {
  const deleted = await client.from("message_attachments").delete().eq("id", attachmentId).is("message_id", null).select("id").maybeSingle();
  if (deleted.error && !schemaUnavailable(deleted.error)) return { error: "We couldn't remove that attachment. Please try again." };
  return {};
}
