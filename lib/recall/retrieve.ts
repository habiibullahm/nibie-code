import "server-only";

import { embeddingKeyConfigured, embedFileTexts, QUERY_EMBEDDING_TIMEOUT_MS, validEmbedding } from "@/lib/files/embeddings";
import { rankMemories } from "@/lib/recall/rank";
import { listOwnerMemories, touchMemoriesUsed, type MemoryStoreClient } from "@/lib/recall/store";
import { MEMORY_RETRIEVE_MAX, type MemoryRecord, type RankedMemory } from "@/lib/recall/types";

export type RetrieveMemoriesInput = {
  supabase: MemoryStoreClient;
  query: string;
  recallEnabled: boolean;
  requestId?: string;
  limit?: number;
};

export type RetrieveMemoriesResult = {
  memories: RankedMemory[];
  degraded: boolean;
};

function mergeById(primary: RankedMemory[], secondary: MemoryRecord[], query: string, limit: number) {
  const byId = new Map<string, RankedMemory>();
  for (const memory of primary) byId.set(memory.id, memory);
  for (const memory of secondary) {
    if (byId.has(memory.id)) continue;
    byId.set(memory.id, { ...memory, score: 0.01, exactIdentifier: false });
  }
  return rankMemories(query, [...byId.values()], limit);
}

async function lexicalRpc(supabase: MemoryStoreClient, query: string, limit: number): Promise<MemoryRecord[]> {
  try {
    const { data, error } = await supabase.rpc("search_memories_lexical", { p_query: query, p_limit: limit });
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((row) => {
      const id = typeof row?.id === "string" ? row.id : null;
      const type = row?.type;
      const content = typeof row?.content === "string" ? row.content : null;
      const normalizedKey = typeof row?.normalized_key === "string" ? row.normalized_key : null;
      if (!id || !content || !normalizedKey) return [];
      if (type !== "preference" && type !== "project" && type !== "instruction" && type !== "fact") return [];
      return [{
        id,
        type,
        content,
        normalizedKey,
        sourceConversationId: null,
        sourceMessageId: null,
        isActive: true,
        createdAt: "",
        updatedAt: "",
        lastUsedAt: null,
      } satisfies MemoryRecord];
    });
  } catch {
    return [];
  }
}

async function semanticRpc(supabase: MemoryStoreClient, query: string, limit: number): Promise<MemoryRecord[]> {
  if (!embeddingKeyConfigured()) return [];
  try {
    const [embedding] = await embedFileTexts([query.slice(0, 3000)], { timeoutMs: QUERY_EMBEDDING_TIMEOUT_MS });
    if (!validEmbedding(embedding)) return [];
    const { data, error } = await supabase.rpc("search_memories_semantic", {
      p_embedding: `[${embedding.join(",")}]`,
      p_limit: limit,
    });
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((row) => {
      const id = typeof row?.id === "string" ? row.id : null;
      const type = row?.type;
      const content = typeof row?.content === "string" ? row.content : null;
      const normalizedKey = typeof row?.normalized_key === "string" ? row.normalized_key : null;
      if (!id || !content || !normalizedKey) return [];
      if (type !== "preference" && type !== "project" && type !== "instruction" && type !== "fact") return [];
      return [{
        id,
        type,
        content,
        normalizedKey,
        sourceConversationId: null,
        sourceMessageId: null,
        isActive: true,
        createdAt: "",
        updatedAt: "",
        lastUsedAt: null,
      } satisfies MemoryRecord];
    });
  } catch {
    return [];
  }
}

/** Bounded retrieval. Soft-fails to empty. Respects recall_enabled and is_active. */
export async function retrieveRelevantMemories(input: RetrieveMemoriesInput): Promise<RetrieveMemoriesResult> {
  const limit = Math.min(Math.max(input.limit ?? MEMORY_RETRIEVE_MAX, 1), MEMORY_RETRIEVE_MAX);
  if (!input.recallEnabled || !input.query.trim()) return { memories: [], degraded: false };

  try {
    const listed = await listOwnerMemories(input.supabase, { activeOnly: true });
    if (listed.error) return { memories: [], degraded: true };

    let ranked = rankMemories(input.query, listed.memories, limit);
    const [lexical, semantic] = await Promise.all([
      lexicalRpc(input.supabase, input.query, limit),
      semanticRpc(input.supabase, input.query, limit),
    ]);
    if (lexical.length || semantic.length) {
      ranked = mergeById(ranked, [...lexical, ...semantic], input.query, limit);
    }

    if (ranked.length) {
      void touchMemoriesUsed(input.supabase, ranked.map((memory) => memory.id));
    }
    return { memories: ranked, degraded: false };
  } catch {
    return { memories: [], degraded: true };
  }
}
