"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { validateConversationId } from "@/lib/chat/validation";
import { parseRoomBrief, parseRoomDraft, parseRoomPatch } from "@/lib/rooms/validation";
import type { RoomBriefFields, RoomOverview } from "@/lib/rooms/types";
import type { RoomBriefRow } from "@/lib/rooms/map";
import { generateRoomOverview } from "@/lib/rooms/generate";
import { deleteRoomFileObjects, type RoomFileClient } from "@/lib/files/service";
import { operationalCodes } from "@/lib/observability/codes";
import { logError } from "@/lib/observability/logger";

export type RoomActionResult<T = undefined> = { data?: T; error?: string };

type RoomRow = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
};

const saveFailed = "We couldn't save that change. Please try again.";
const unavailable = "That room is no longer available.";
const sessionFailed = "Your session has expired or the service is unavailable. Please try again.";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error(sessionFailed);
  return { supabase, user };
}

function failedRoom(error: { code?: string } | null): RoomActionResult<never> | null {
  if (!error) return null;
  if (error.code === "23514") return { error: "That room text is too long." };
  return { error: saveFailed };
}

export async function draftRoomAction(input: unknown): Promise<RoomActionResult<RoomOverview>> {
  const parsed = parseRoomDraft(input);
  if ("error" in parsed) return { error: parsed.error };
  try { await authenticatedClient(); } catch { return { error: sessionFailed }; }
  try { return { data: await generateRoomOverview(parsed.data) }; }
  catch (error) {
    logError("room.draft.failed", { code: operationalCodes.roomDraftFailed, errorName: safeErrorName(error) });
    return { error: "Nibie couldn't draft this room. Try again or set it up manually." };
  }
}

export async function createRoomAction(input: unknown, briefInput: unknown = undefined): Promise<RoomActionResult<RoomRow & { brief: RoomBriefRow | null }>> {
  const parsed = parseRoomDraft(input);
  if ("error" in parsed) return { error: parsed.error };
  const parsedBrief = briefInput === undefined ? null : parseRoomBrief(briefInput);
  if (parsedBrief && "error" in parsedBrief) return { error: parsedBrief.error };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("rooms").insert({
      user_id: user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    }).select("id,name,description,instructions,created_at,updated_at").single();
    const failure = failedRoom(error);
    if (failure) return failure;
    if (!data) return { error: saveFailed };
    const brief: RoomBriefRow | null = parsedBrief ? {
      goal: parsedBrief.data.goal,
      current_focus: parsedBrief.data.currentFocus,
      important_decisions: parsedBrief.data.importantDecisions,
      open_questions: parsedBrief.data.openQuestions,
      next_step: parsedBrief.data.next,
    } : null;
    if (brief) {
      try {
        const { error: briefError } = await supabase.from("room_briefs").insert({ room_id: data.id, user_id: user.id, ...brief });
        if (briefError) throw new Error(saveFailed);
      } catch {
        // Match first-chat creation: remove the new, empty room if its brief could not be saved.
        const { error: cleanupError } = await supabase.from("rooms").delete().eq("id", data.id);
        if (cleanupError) return { error: "The room was created, but its brief couldn't be saved. Refresh to edit it." };
        return { error: saveFailed };
      }
    }
    return { data: { ...data, brief } };
  } catch {
    return { error: sessionFailed };
  }
}

export async function updateRoomAction(id: unknown, input: unknown): Promise<RoomActionResult<RoomRow>> {
  const parsedId = validateConversationId(id);
  const parsed = parseRoomPatch(input);
  if (!parsedId.success) return { error: "Choose a valid room." };
  if ("error" in parsed) return { error: parsed.error };
  const patch: { name?: string; description?: string | null; instructions?: string | null } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.instructions !== undefined) patch.instructions = parsed.data.instructions;
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("rooms").update(patch).eq("id", parsedId.data).select("id,name,description,instructions,created_at,updated_at").maybeSingle();
    const failure = failedRoom(error);
    if (failure) return failure;
    if (!data) return { error: unavailable };
    return { data };
  } catch {
    return { error: sessionFailed };
  }
}

export async function updateRoomBriefAction(id: unknown, input: unknown): Promise<RoomActionResult<RoomBriefFields>> {
  const parsedId = validateConversationId(id);
  const parsed = parseRoomBrief(input);
  if (!parsedId.success) return { error: "Choose a valid room." };
  if ("error" in parsed) return { error: parsed.error };
  try {
    const { supabase, user } = await authenticatedClient();
    const { data: room, error: roomError } = await supabase.from("rooms").select("id").eq("id", parsedId.data).maybeSingle();
    if (roomError) return { error: saveFailed };
    if (!room) return { error: unavailable };
    const { error } = await supabase.from("room_briefs").upsert({
      room_id: parsedId.data,
      user_id: user.id,
      goal: parsed.data.goal,
      current_focus: parsed.data.currentFocus,
      important_decisions: parsed.data.importantDecisions,
      open_questions: parsed.data.openQuestions,
      next_step: parsed.data.next,
    }, { onConflict: "room_id" });
    const failure = failedRoom(error);
    if (failure) return failure;
    return { data: parsed.data };
  } catch {
    return { error: sessionFailed };
  }
}

export async function deleteRoomAction(id: unknown): Promise<RoomActionResult> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid room." };
  try {
    const { supabase, user } = await authenticatedClient();
    const removed = await deleteRoomFileObjects(supabase as unknown as RoomFileClient, user.id, parsedId.data);
    if (removed.error) return { error: removed.error };
    const { data, error } = await supabase.from("rooms").delete().eq("id", parsedId.data).select("id").maybeSingle();
    if (error) return { error: saveFailed };
    if (!data) return { error: unavailable };
    return {};
  } catch {
    return { error: sessionFailed };
  }
}

function safeErrorName(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : "UnknownError";
}
