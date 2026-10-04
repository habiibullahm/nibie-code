import { attachmentTypeLabel } from "@/lib/attachments/limits";
import type { AttachmentContextInput } from "@/lib/context/context-types";

export type AttachmentContextRow = { message_id: string | null; original_name: string; mime_type: string; extracted_text: string; truncated: boolean; page_count: number | null; created_at: string };
export type ContextMessageRow = { id: string; role: string; position: number };

// Attachments of the user messages in context: the current message's first (in the order attached), then earlier
// messages newest first. An attachment of a message outside the context window is not used.
export function contextAttachments(rows: AttachmentContextRow[], messages: ContextMessageRow[], currentMessageId: string): AttachmentContextInput[] {
  const positions = new Map(messages.filter((message) => message.role === "user").map((message) => [message.id, message.position]));
  return rows
    .filter((row) => row.message_id && positions.has(row.message_id))
    .sort((left, right) => (positions.get(right.message_id!)! - positions.get(left.message_id!)!) || left.created_at.localeCompare(right.created_at))
    .map((row) => ({
      name: row.original_name,
      typeLabel: attachmentTypeLabel(row.mime_type),
      text: row.extracted_text,
      truncated: Boolean(row.truncated),
      pageCount: row.page_count ?? null,
      current: row.message_id === currentMessageId,
    }));
}
