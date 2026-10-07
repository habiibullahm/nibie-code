"use server";

import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { validateConversationId } from "@/lib/chat/validation";
import { parseMemoryDraft } from "@/lib/recall/normalize";
import {
  deactivateOwnerMemory,
  deleteOwnerMemory,
  listOwnerMemoriesAll,
  listOwnerMemoriesPage,
  updateOwnerMemory,
  upsertMemoryByKey,
} from "@/lib/recall/store";
import type { MemoryRecord } from "@/lib/recall/types";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MemoryActionResult<T = undefined> = { data?: T; error?: string };

const sessionFailed = "Your session has expired or the service is unavailable. Please try again.";
const saveFailed = "We couldn't save that change. Please try again.";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error(sessionFailed);
  return { supabase, user };
}

/** Full Settings list via paging (not capped at retrieval's 80). */
export async function listMemoriesAction(): Promise<MemoryActionResult<MemoryRecord[]>> {
  try {
    const { supabase } = await authenticatedClient();
    const result = await listOwnerMemoriesAll(supabase, { activeOnly: "all" });
    if (result.error) return { error: result.error };
    return { data: result.memories };
  } catch {
    return { error: sessionFailed };
  }
}

export async function listMemoriesPageAction(input?: {
  offset?: number;
  activeOnly?: boolean | "all";
}): Promise<MemoryActionResult<{ memories: MemoryRecord[]; hasMore: boolean; nextOffset: number }>> {
  try {
    const { supabase } = await authenticatedClient();
    const page = await listOwnerMemoriesPage(supabase, {
      offset: input?.offset ?? 0,
      activeOnly: input?.activeOnly ?? "all",
    });
    if (page.error) return { error: page.error };
    return { data: { memories: page.memories, hasMore: page.hasMore, nextOffset: page.nextOffset } };
  } catch {
    return { error: sessionFailed };
  }
}

export async function createMemoryAction(input: unknown): Promise<MemoryActionResult<MemoryRecord>> {
  const parsed = parseMemoryDraft(input);
  if ("error" in parsed) return { error: parsed.error };
  try {
    const { supabase, user } = await authenticatedClient();
    const result = await upsertMemoryByKey(supabase, user.id, parsed.data);
    if (result.error || !result.memory) return { error: result.error ?? saveFailed };
    logInfo("memory.write.succeeded", { type: result.memory.type, stage: "settings" });
    return { data: result.memory };
  } catch {
    return { error: sessionFailed };
  }
}

export async function updateMemoryAction(id: unknown, input: unknown): Promise<MemoryActionResult<MemoryRecord>> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid memory." };
  try {
    const { supabase } = await authenticatedClient();
    const result = await updateOwnerMemory(supabase, parsedId.data, input);
    if (result.error || !result.memory) return { error: result.error ?? saveFailed };
    logInfo("memory.updated", { type: result.memory.type });
    return { data: result.memory };
  } catch {
    return { error: sessionFailed };
  }
}

export async function forgetMemoryAction(id: unknown): Promise<MemoryActionResult> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid memory." };
  try {
    const { supabase } = await authenticatedClient();
    const result = await deactivateOwnerMemory(supabase, parsedId.data);
    if (!result.ok) return { error: result.error ?? saveFailed };
    logInfo("memory.deleted", { stage: "forget" });
    return {};
  } catch {
    return { error: sessionFailed };
  }
}

export async function deleteMemoryAction(id: unknown): Promise<MemoryActionResult> {
  const parsedId = validateConversationId(id);
  if (!parsedId.success) return { error: "Choose a valid memory." };
  try {
    const { supabase } = await authenticatedClient();
    const result = await deleteOwnerMemory(supabase, parsedId.data);
    if (!result.ok) return { error: result.error ?? saveFailed };
    logInfo("memory.deleted", { stage: "delete" });
    return {};
  } catch {
    return { error: sessionFailed };
  }
}

export async function listActiveMemoriesAction(): Promise<MemoryActionResult<MemoryRecord[]>> {
  try {
    const { supabase } = await authenticatedClient();
    const result = await listOwnerMemoriesAll(supabase, { activeOnly: true });
    if (result.error) {
      logWarn("memory.retrieve.completed", { category: "settings_list", degraded: true });
      return { error: result.error };
    }
    return { data: result.memories };
  } catch {
    return { error: sessionFailed };
  }
}
