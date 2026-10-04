"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { validateConversationId } from "@/lib/chat/validation";
import { deleteRoomFile, listRoomFiles, type RoomFileClient } from "@/lib/files/service";
import type { RoomFileSummary } from "@/lib/files/types";

export type FileActionResult<T = undefined> = { data?: T; error?: string };

const sessionFailed = "Your session has expired or the service is unavailable. Please try again.";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error(sessionFailed);
  return { supabase: supabase as unknown as RoomFileClient, user };
}

export async function listRoomFilesAction(roomId: unknown): Promise<FileActionResult<RoomFileSummary[]>> {
  const parsed = validateConversationId(roomId);
  if (!parsed.success) return { error: "Choose a valid room." };
  try {
    const { supabase } = await authenticatedClient();
    return await listRoomFiles(supabase, parsed.data);
  } catch {
    return { error: sessionFailed };
  }
}

export async function deleteRoomFileAction(roomId: unknown, fileId: unknown): Promise<FileActionResult> {
  const parsedRoom = validateConversationId(roomId);
  const parsedFile = validateConversationId(fileId);
  if (!parsedRoom.success || !parsedFile.success) return { error: "Choose a valid file." };
  try {
    const { supabase, user } = await authenticatedClient();
    const result = await deleteRoomFile(supabase, user.id, parsedRoom.data, parsedFile.data);
    if (result.error) return { error: result.error };
    return {};
  } catch {
    return { error: sessionFailed };
  }
}
