import "server-only";

import { z } from "zod";
import { draftFromSaveBody, extractDurableStatement, parseMemoryDraft } from "@/lib/recall/normalize";
import { memoryTopicKey } from "@/lib/recall/topic";
import {
  MEMORY_LIST_HARD_CAP,
  MEMORY_RETRIEVE_CANDIDATE_CAP,
  MEMORY_SETTINGS_PAGE_SIZE,
  memoryTypes,
  type MemoryDraft,
  type MemoryRecord,
  type MemoryType,
} from "@/lib/recall/types";
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

function parseRows(data: unknown): MemoryRecord[] {
  const memories: MemoryRecord[] = [];
  for (const row of Array.isArray(data) ? data : []) {
    const parsed = memoryRowSchema.safeParse(row);
    if (parsed.success) memories.push(fromRow(parsed.data));
  }
  return memories;
}

/** Bounded candidate pool for chat retrieval ranking only. */
export async function listOwnerMemoriesForRetrieval(
  supabase: MemoryStoreClient,
  options?: { activeOnly?: boolean },
): Promise<{ memories: MemoryRecord[]; error: string | null }> {
  try {
    let query = supabase
      .from("memories")
      .select(memoryColumns)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true });
    if (options?.activeOnly !== false) query = query.eq("is_active", true);
    const { data, error } = await query.limit(MEMORY_RETRIEVE_CANDIDATE_CAP);
    if (error) return { memories: [], error: loadError };
    return { memories: parseRows(data), error: null };
  } catch {
    return { memories: [], error: loadError };
  }
}

export type MemoryListPage = {
  memories: MemoryRecord[];
  hasMore: boolean;
  nextOffset: number;
  error: string | null;
};

/** Paginated listing for Settings. Not capped at the retrieval candidate limit. */
export async function listOwnerMemoriesPage(
  supabase: MemoryStoreClient,
  options?: { activeOnly?: boolean | "all"; offset?: number; limit?: number },
): Promise<MemoryListPage> {
  const offset = Math.max(0, options?.offset ?? 0);
  const limit = Math.min(Math.max(options?.limit ?? MEMORY_SETTINGS_PAGE_SIZE, 1), MEMORY_SETTINGS_PAGE_SIZE);
  try {
    let query = supabase
      .from("memories")
      .select(memoryColumns)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true });
    if (options?.activeOnly === true) query = query.eq("is_active", true);
    if (options?.activeOnly === false) query = query.eq("is_active", false);
    const { data, error } = await query.range(offset, offset + limit - 1);
    if (error) return { memories: [], hasMore: false, nextOffset: offset, error: loadError };
    const memories = parseRows(data);
    return {
      memories,
      hasMore: memories.length === limit && offset + memories.length < MEMORY_LIST_HARD_CAP,
      nextOffset: offset + memories.length,
      error: null,
    };
  } catch {
    return { memories: [], hasMore: false, nextOffset: offset, error: loadError };
  }
}

/** Walk pages until exhausted or hard cap (Settings full list / topic scans). */
export async function listOwnerMemoriesAll(
  supabase: MemoryStoreClient,
  options?: { activeOnly?: boolean | "all" },
): Promise<{ memories: MemoryRecord[]; error: string | null }> {
  const memories: MemoryRecord[] = [];
  let offset = 0;
  while (offset < MEMORY_LIST_HARD_CAP) {
    const page = await listOwnerMemoriesPage(supabase, {
      activeOnly: options?.activeOnly ?? "all",
      offset,
      limit: MEMORY_SETTINGS_PAGE_SIZE,
    });
    if (page.error) return { memories: [], error: page.error };
    memories.push(...page.memories);
    if (!page.hasMore || !page.memories.length) break;
    offset = page.nextOffset;
  }
  return { memories, error: null };
}

async function deactivateConflictingTopicMemories(
  supabase: MemoryStoreClient,
  draft: MemoryDraft,
): Promise<void> {
  const topic = memoryTopicKey(draft.type, draft.content);
  if (!topic) return;
  const listed = await listOwnerMemoriesAll(supabase, { activeOnly: true });
  if (listed.error) return;
  for (const memory of listed.memories) {
    if (memory.normalizedKey === draft.normalizedKey) continue;
    if (memoryTopicKey(memory.type, memory.content) !== topic) continue;
    await deactivateOwnerMemory(supabase, memory.id);
  }
}

export async function upsertMemoryByKey(supabase: MemoryStoreClient, userId: string, draft: MemoryDraft): Promise<{ memory: MemoryRecord | null; error: string | null }> {
  try {
    await deactivateConflictingTopicMemories(supabase, draft);
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
    await deactivateConflictingTopicMemories(supabase, parsed.data);
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

/** Forget lookup across the full active set — not limited to the retrieval candidate cap. */
export async function deactivateMatchingMemories(supabase: MemoryStoreClient, forgetBody: string): Promise<{ count: number; error: string | null }> {
  const cleaned = extractDurableStatement(forgetBody);
  const draft = draftFromSaveBody(cleaned);
  const needle = (draft?.normalizedKey ?? cleaned.toLowerCase().replace(/\s+/g, " ").trim()).slice(0, 200);
  if (!needle) return { count: 0, error: null };
  try {
    const topic = draft ? memoryTopicKey(draft.type, draft.content) : null;
    const listed = await listOwnerMemoriesAll(supabase, { activeOnly: true });
    if (listed.error) return { count: 0, error: listed.error };

    const exact = listed.memories.filter((memory) => memory.normalizedKey === needle);
    let matches = exact;
    if (!matches.length && topic) {
      matches = listed.memories.filter((memory) => memoryTopicKey(memory.type, memory.content) === topic);
    }
    if (!matches.length && needle.length >= 12) {
      matches = listed.memories.filter(
        (memory) => memory.normalizedKey.includes(needle) || memory.content.toLowerCase().includes(needle),
      );
    }

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

/** @deprecated Prefer listOwnerMemoriesForRetrieval / listOwnerMemoriesPage / listOwnerMemoriesAll. */
export async function listOwnerMemories(
  supabase: MemoryStoreClient,
  options?: { activeOnly?: boolean },
): Promise<{ memories: MemoryRecord[]; error: string | null }> {
  return listOwnerMemoriesForRetrieval(supabase, options);
}

export type { MemoryType };
