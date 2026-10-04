"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { validateConversationId } from "@/lib/chat/validation";
import { parsePinDraft } from "@/lib/pins/validation";

export type PinActionResult<T = undefined> = { data?: T; error?: string };

export type PinRow = {
  id: string;
  room_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

const saveFailed = "We couldn't save that change. Please try again.";
const roomUnavailable = "That room is no longer available.";
const pinUnavailable = "That pin is no longer available.";
const sessionFailed = "Your session has expired or the service is unavailable. Please try again.";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error(sessionFailed);
  return { supabase, user };
}

function failedPin(error: { code?: string } | null): PinActionResult<never> | null {
  if (!error) return null;
  if (error.code === "23514") return { error: "That pin text is too long." };
  if (error.code === "23503") return { error: roomUnavailable };
  return { error: saveFailed };
}

export async function createPinAction(roomId: unknown, input: unknown): Promise<PinActionResult<PinRow>> {
  const parsedRoomId = validateConversationId(roomId);
  const parsed = parsePinDraft(input);
  if (!parsedRoomId.success) return { error: "Choose a valid room." };
  if ("error" in parsed) return { error: parsed.error };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data: room, error: roomError } = await supabase.from("rooms").select("id").eq("id", parsedRoomId.data).maybeSingle();
    if (roomError) return { error: saveFailed };
    if (!room) return { error: roomUnavailable };
    const { data, error } = await supabase.from("pins").insert({
      user_id: user.id,
      room_id: parsedRoomId.data,
      title: parsed.data.title,
      content: parsed.data.content,
    }).select("id,room_id,title,content,created_at,updated_at").single();
    const failure = failedPin(error);
    if (failure) return failure;
    if (!data) return { error: saveFailed };
    return { data };
  } catch {
    return { error: sessionFailed };
  }
}

export async function updatePinAction(id: unknown, input: unknown): Promise<PinActionResult<PinRow>> {
  const parsedId = validateConversationId(id);
  const parsed = parsePinDraft(input);
  if (!parsedId.success) return { error: "Choose a valid pin." };
  if ("error" in parsed) return { error: parsed.error };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("pins").update({
      title: parsed.data.title,
      content: parsed.data.content,
    }).eq("id", parsedId.data).select("id,room_id,title,content,created_at,updated_at").maybeSingle();
    const failure = failedPin(error);
    if (failure) return failure;
    if (!data) return { error: pinUnavailable };
    return { data };
  } catch {
    return { error: sessionFailed };
  }
}

export async function deletePinAction(id: unknown): Promise<PinActionResult> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid pin." };
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("pins").delete().eq("id", parsedId.data).select("id").maybeSingle();
    if (error) return { error: saveFailed };
    if (!data) return { error: pinUnavailable };
    return {};
  } catch {
    return { error: sessionFailed };
  }
}
