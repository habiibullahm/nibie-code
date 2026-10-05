"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { isDeleteAllConfirmed } from "@/lib/privacy/confirmation";
import { schemaUnavailable } from "@/lib/chat/schema-error";

const unavailable = "Your session has expired or the service is unavailable. Please try again.";
const deleteFailed = "Conversations couldn't be deleted. Please try again.";

export type DeleteAllResult = { deletedCount?: number; error?: string };

// Deletes every conversation owned by the verified session. Messages, and the attachments sent with them, go with them
// through the existing conversation cascade; unsent draft attachments are deleted too. The auth user and
// user_preferences are not in these statements. The caller cannot name a user id.
export async function deleteAllConversationsAction(confirmation: unknown): Promise<DeleteAllResult> {
  if (!isDeleteAllConfirmed(confirmation)) return { error: "Type DELETE to confirm." };

  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return { error: unavailable };

    const { data, error } = await supabase.from("conversations").delete().eq("user_id", user.id).select("id");
    if (error || !data) return { error: deleteFailed };
    const drafts = await supabase.from("message_attachments").delete().eq("user_id", user.id).is("message_id", null);
    if (drafts.error && !schemaUnavailable(drafts.error)) return { error: deleteFailed };
    return { deletedCount: data.length };
  } catch {
    return { error: unavailable };
  }
}
