import "server-only";

import { z } from "zod";
import { draftFromSaveBody, parseMemoryDraft } from "@/lib/recall/normalize";
import { MEMORY_RETRIEVE_CANDIDATE_CAP, memoryTypes, type MemoryDraft, type MemoryRecord, type MemoryType } from "@/lib/recall/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const memoryColumns = "id,type,content,normalized_key,source_conversation_id,source_message_id,is_active,created_at,updated_at,last_used_at";

const memoryRowSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(memoryTypes),
  content: z.string().min(1).max(1000),
  normalized_key: z.string().min(1).max(200),
  source_conversation_id: z.string().uuid().nullable(),
  source_message_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  last_used_at: z.string().nullable(),
});

export type MemoryStoreClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const loadError = "Memories couldn't be loaded. Refresh to try again.";
const saveError = "We couldn't save that memory. Please try again.";

function fromRow(row: z.infer<typeof memoryRowSchema>): MemoryRecord {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    normalizedKey: row.normalized_key,
    sourceConversationId: row.source_conversation_id,
    sourceMessageId: row.source_message_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

function toInsert(userId: string, draft: MemoryDraft) {
  return {
    user_id: userId,
    type: draft.type,
    content: draft.content,
    normalized_key: draft.normalizedKey,
    source_conversation_id: draft.sourceConversationId ?? null,
    source_message_id: draft.sourceMessageId ?? null,
    is_active: true,
  };
}

export async function listOwnerMemories(supabase: MemoryStoreClient, options?: { activeOnly?: boolean }): Promise<{ memories: MemoryRecord[]; error: string | null }> {
  try {
    let query = supabase.from("memories").select(memoryColumns).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(MEMORY_RETRIEVE_CANDIDATE_CAP);
    if (options?.activeOnly !== false) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) return { memories: [], error: loadError };
    const memories: MemoryRecord[] = [];
    for (const row of data ?? []) {
      const parsed = memoryRowSchema.safeParse(row);
      if (parsed.success) memories.push(fromRow(parsed.data));
    }
    return { memories, error: null };
  } catch {
    return { memories: [], error: loadError };
  }
}

export async function upsertMemoryByKey(supabase: MemoryStoreClient, userId: string, draft: MemoryDraft): Promise<{ memory: MemoryRecord | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("memories")
      .upsert(toInsert(userId, draft), { onConflict: "user_id,normalized_key" })
      .select(memoryColumns)
      .single();
    if (error || !data) return { memory: null, error: saveError };
    const parsed = memoryRowSchema.safeParse(data);
    if (!parsed.success) return { memory: null, error: saveError };
    return { memory: fromRow(parsed.data), error: null };
  } catch {
    return { memory: null, error: saveError };
  }
}

export async function updateOwnerMemory(supabase: MemoryStoreClient, id: string, input: unknown): Promise<{ memory: MemoryRecord | null; error: string | null }> {
  const parsed = parseMemoryDraft(input);
  if ("error" in parsed) return { memory: null, error: parsed.error };
  try {
    const { data, error } = await supabase
      .from("memories")
      .update({
        type: parsed.data.type,
        content: parsed.data.content,
        normalized_key: parsed.data.normalizedKey,
        is_active: true,
      })
      .eq("id", id)
      .select(memoryColumns)
      .maybeSingle();
    if (error) return { memory: null, error: saveError };
    if (!data) return { memory: null, error: "That memory is no longer available." };
    const row = memoryRowSchema.safeParse(data);
    if (!row.success) return { memory: null, error: saveError };
    return { memory: fromRow(row.data), error: null };
  } catch {
    return { memory: null, error: saveError };
  }
}

export async function deactivateOwnerMemory(supabase: MemoryStoreClient, id: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.from("memories").update({ is_active: false }).eq("id", id).select("id").maybeSingle();
    if (error) return { ok: false, error: saveError };
    if (!data) return { ok: false, error: "That memory is no longer available." };
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: saveError };
  }
}

export async function deleteOwnerMemory(supabase: MemoryStoreClient, id: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.from("memories").delete().eq("id", id).select("id").maybeSingle();
    if (error) return { ok: false, error: saveError };
    if (!data) return { ok: false, error: "That memory is no longer available." };
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: saveError };
  }
}

export async function deactivateMatchingMemories(supabase: MemoryStoreClient, forgetBody: string): Promise<{ count: number; error: string | null }> {
  const draft = draftFromSaveBody(forgetBody);
  const needle = (draft?.normalizedKey ?? forgetBody.toLowerCase().replace(/\s+/g, " ").trim()).slice(0, 200);
  if (!needle) return { count: 0, error: null };
  try {
    const { memories, error } = await listOwnerMemories(supabase, { activeOnly: true });
    if (error) return { count: 0, error };
    const exact = memories.filter((memory) => memory.normalizedKey === needle);
    // Prefer exact key matches. Substring matches require a substantial needle to avoid over-delete.
    const matches = exact.length
      ? exact
      : needle.length >= 12
        ? memories.filter((memory) => memory.normalizedKey.includes(needle) || memory.content.toLowerCase().includes(needle))
        : [];
    let count = 0;
    for (const memory of matches) {
      const result = await deactivateOwnerMemory(supabase, memory.id);
      if (result.ok) count += 1;
    }
    return { count, error: null };
  } catch {
    return { count: 0, error: saveError };
  }
}

export async function touchMemoriesUsed(supabase: MemoryStoreClient, ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await supabase.from("memories").update({ last_used_at: new Date().toISOString() }).in("id", ids);
  } catch {
    /* soft-fail */
  }
}

export type { MemoryType };
