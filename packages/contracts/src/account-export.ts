import {
  DELETE_ALL_CONFIRMATION as deleteAllConfirmation,
  EXPORT_PAGE_SIZE as exportPageSize,
  EXPORT_PRODUCT as exportProduct,
  EXPORT_VERSION as exportVersion,
  SIGN_OUT_SCOPE as signOutScope,
  isDeleteAllConfirmed as confirmDeleteAll,
} from "./account-constants.ts";

export {
  deleteAllConfirmation as DELETE_ALL_CONFIRMATION,
  exportPageSize as EXPORT_PAGE_SIZE,
  exportProduct as EXPORT_PRODUCT,
  exportVersion as EXPORT_VERSION,
  signOutScope as SIGN_OUT_SCOPE,
  confirmDeleteAll as isDeleteAllConfirmed,
};

const roles = new Set(["user", "assistant"]);
const statuses = new Set(["complete", "streaming", "interrupted", "error"]);

export type ExportConversationRow = {
  id: string;
  title: string;
  selected_model: string;
  chat_role?: string | null;
  custom_instructions?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type ExportMessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  position: number;
  created_at: string | Date;
  reply_to_message_id: string | null;
};

export type ExportedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "interrupted" | "error";
  position: number;
  createdAt: string;
  replyToMessageId: string | null;
};

export type ExportedConversation = {
  id: string;
  title: string;
  selectedModel: string;
  chatRole?: string;
  customInstructions?: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ExportedMessage[];
};

export type NibieExport = {
  product: typeof exportProduct;
  exportVersion: typeof exportVersion;
  exportedAt: string;
  conversations: ExportedConversation[];
};

export type ExportPage<T> = { data: T[] | null; error: unknown };

// Reads every owned page. A short page ends the read. An error or a non-advancing full page fails the whole export
// so the file is never a silent partial copy.
export async function readAllPages<T extends { id: string }>(
  fetchPage: (from: number, to: number) => Promise<ExportPage<T>>,
  pageSize = exportPageSize,
): Promise<T[] | null> {
  if (pageSize < 1) return null;
  const rows: T[] = [];
  let previousLastId: string | undefined;
  // Stop rather than truncate if paging never reaches a short page. A partial file must not look complete.
  const maxPages = 200;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const from = pageIndex * pageSize;
    let page: ExportPage<T>;
    try {
      page = await fetchPage(from, from + pageSize - 1);
    } catch {
      return null;
    }
    if (page.error || !page.data) return null;
    if (page.data.length > pageSize) return null;
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
    const lastId = page.data[page.data.length - 1]?.id;
    if (!lastId || lastId === previousLastId) return null;
    previousLastId = lastId;
  }
  return null;
}

function timestamp(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function byId(left: { id: string }, right: { id: string }) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

// Builds export version 1 from owner-scoped rows. Field lists are explicit so credentials, user ids, and provider
// configuration cannot ride along on a select *. Returns null when the snapshot is incomplete or inconsistent.
export function buildConversationExport(input: {
  conversations: ExportConversationRow[];
  messages: ExportMessageRow[];
  exportedAt: string | Date;
}): NibieExport | null {
  const exportedAt = timestamp(input.exportedAt);
  if (!exportedAt) return null;

  const conversations = [...input.conversations].sort((left, right) => {
    const created = String(timestamp(left.created_at) ?? "").localeCompare(String(timestamp(right.created_at) ?? ""));
    return created || byId(left, right);
  });
  const messages = [...input.messages].sort((left, right) => {
    const conversation = left.conversation_id < right.conversation_id ? -1 : left.conversation_id > right.conversation_id ? 1 : 0;
    return conversation || left.position - right.position || byId(left, right);
  });

  const grouped = new Map<string, ExportedMessage[]>();
  for (const message of messages) {
    if (!roles.has(message.role) || !statuses.has(message.status) || !Number.isInteger(message.position)) return null;
    const createdAt = timestamp(message.created_at);
    if (!createdAt) return null;
    const exported: ExportedMessage = {
      id: message.id,
      role: message.role as ExportedMessage["role"],
      content: message.content,
      status: message.status as ExportedMessage["status"],
      position: message.position,
      createdAt,
      replyToMessageId: message.reply_to_message_id,
    };
    const bucket = grouped.get(message.conversation_id);
    if (bucket) bucket.push(exported);
    else grouped.set(message.conversation_id, [exported]);
  }

  const exportedConversations: ExportedConversation[] = [];
  for (const conversation of conversations) {
    const createdAt = timestamp(conversation.created_at);
    const updatedAt = timestamp(conversation.updated_at);
    if (!createdAt || !updatedAt) return null;
    exportedConversations.push({
      id: conversation.id,
      title: conversation.title,
      selectedModel: conversation.selected_model,
      chatRole: conversation.chat_role ?? "general",
      customInstructions: conversation.custom_instructions ?? null,
      createdAt,
      updatedAt,
      messages: grouped.get(conversation.id) ?? [],
    });
    grouped.delete(conversation.id);
  }

  // A message whose conversation was not in the same snapshot must not be dropped quietly.
  if (grouped.size > 0) return null;

  return {
    product: exportProduct,
    exportVersion,
    exportedAt,
    conversations: exportedConversations,
  };
}
