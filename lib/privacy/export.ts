import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import {
  buildConversationExport as buildConversationExportUnsanitized,
  type ExportAttachmentRow,
  type ExportConversationRow,
  type ExportMessageRow,
} from "../../packages/contracts/src/account-export";

export {
  EXPORT_FILENAME,
  EXPORT_PAGE_SIZE,
  EXPORT_PRODUCT,
  EXPORT_VERSION,
  readAllPages,
} from "../../packages/contracts/src/account-export";

type ConversationExportInput = {
  conversations: ExportConversationRow[];
  messages: ExportMessageRow[];
  attachments?: ExportAttachmentRow[];
  exportedAt: string | Date;
};

// Assistant rows are sanitized at the export boundary so an older stored reply
// cannot leave internal reasoning in the download. User text is left unchanged.
export function buildConversationExport(input: ConversationExportInput) {
  return buildConversationExportUnsanitized({
    ...input,
    messages: input.messages.map((message) => message.role === "assistant"
      ? { ...message, content: sanitizeModelOutput(message.content).text }
      : message),
  });
}

export type {
  ExportAttachmentRow,
  ExportConversationRow,
  ExportMessageRow,
  ExportPage,
  ExportedAttachment,
  ExportedConversation,
  ExportedMessage,
  NibieExport,
} from "../../packages/contracts/src/account-export";
