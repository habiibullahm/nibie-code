import {
  EXPORT_PAGE_SIZE,
  accountExportSchema,
  buildConversationExport,
  deleteConversationsResponseSchema,
  readAllPages,
  type AccountExport,
  type DeleteConversationsResponse,
  type ExportAttachmentRow,
  type ExportConversationRow,
  type ExportMessageRow,
} from "@nibie/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../plugins/error-handler.js";

const conversationColumns = "id,title,selected_model,created_at,updated_at";
const messageColumns = "id,conversation_id,role,content,status,position,created_at,reply_to_message_id";
const attachmentColumns = "id,message_id,original_name,extracted_text";

const exportFailed = "Your conversations couldn't be exported. Please try again.";
const deleteFailed = "Conversations couldn't be deleted. Please try again.";

type OrderedQuery = {
  order: (column: string, options: { ascending: boolean }) => OrderedQuery;
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>;
};

type PageError = { code?: string } | null;

function owned(query: OrderedQuery, ...columns: string[]) {
  return columns.reduce((current, column) => current.order(column, { ascending: true }), query);
}

function throwForDatabaseError(error: { code?: string }, message: string): never {
  if (error.code === "42501") throw new ApiError(403, "forbidden", "Forbidden.");
  throw new ApiError(503, "service_unavailable", message);
}

// Deletes every conversation owned by the verified subject. Messages follow the conversation cascade.
// The Auth user and user_preferences are not in this statement.
export async function deleteAllConversations(supabase: SupabaseClient, userId: string): Promise<DeleteConversationsResponse> {
  const { data, error } = await supabase.from("conversations").delete().eq("user_id", userId).select("id");
  if (error) throwForDatabaseError(error, deleteFailed);
  if (!Array.isArray(data)) throw new ApiError(503, "service_unavailable", deleteFailed);
  return deleteConversationsResponseSchema.parse({ deletedCount: data.length });
}

export async function exportAccount(supabase: SupabaseClient, userId: string): Promise<AccountExport> {
  let forbidden = false;

  const conversations = await readAllPages<ExportConversationRow>(async (from, to) => {
    const query = owned(
      supabase.from("conversations").select(conversationColumns).eq("user_id", userId) as unknown as OrderedQuery,
      "created_at",
      "id",
    );
    return readPage<ExportConversationRow>(query, from, to, () => {
      forbidden = true;
    });
  }, EXPORT_PAGE_SIZE);

  if (forbidden) throw new ApiError(403, "forbidden", "Forbidden.");
  if (!conversations) throw new ApiError(503, "service_unavailable", exportFailed);

  const messages = await readAllPages<ExportMessageRow>(async (from, to) => {
    const query = owned(
      supabase.from("messages").select(messageColumns).eq("user_id", userId) as unknown as OrderedQuery,
      "conversation_id",
      "position",
      "id",
    );
    return readPage<ExportMessageRow>(query, from, to, () => {
      forbidden = true;
    });
  }, EXPORT_PAGE_SIZE);

  if (forbidden) throw new ApiError(403, "forbidden", "Forbidden.");
  if (!messages) throw new ApiError(503, "service_unavailable", exportFailed);

  const attachments = await readAllPages<ExportAttachmentRow>(async (from, to) => {
    const query = owned(
      supabase.from("message_attachments").select(attachmentColumns).eq("user_id", userId) as unknown as OrderedQuery,
      "message_id",
      "id",
    );
    return readPage<ExportAttachmentRow>(query, from, to, () => {
      forbidden = true;
    });
  }, EXPORT_PAGE_SIZE);

  if (forbidden) throw new ApiError(403, "forbidden", "Forbidden.");
  if (!attachments) throw new ApiError(503, "service_unavailable", exportFailed);

  const payload = buildConversationExport({
    conversations,
    messages,
    attachments,
    exportedAt: new Date().toISOString(),
  });
  const parsed = payload ? accountExportSchema.safeParse(payload) : null;
  if (!parsed?.success) throw new ApiError(503, "service_unavailable", exportFailed);
  return parsed.data;
}

async function readPage<T>(
  query: OrderedQuery,
  from: number,
  to: number,
  onForbidden: () => void,
): Promise<{ data: T[] | null; error: PageError }> {
  try {
    const result = await query.range(from, to);
    if (result.error?.code === "42501") onForbidden();
    return { data: result.data as T[] | null, error: result.error };
  } catch {
    return { data: null, error: { code: "read_failed" } };
  }
}
