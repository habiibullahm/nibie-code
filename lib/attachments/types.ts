// What the client may know about an attachment: never its extracted text or its owner.
export type AttachmentSummary = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  truncated: boolean;
  pageCount: number | null;
};

export type AttachmentRow = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  truncated: boolean;
  page_count: number | null;
};

export const attachmentSummaryColumns = "id,original_name,mime_type,size_bytes,truncated,page_count";

export function toAttachmentSummary(row: AttachmentRow): AttachmentSummary {
  return {
    id: String(row.id),
    name: String(row.original_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    truncated: Boolean(row.truncated),
    pageCount: row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
  };
}
