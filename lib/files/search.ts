import "server-only";
import { embedFileTexts } from "./embeddings";
import { buildLexicalSearchQuery } from "./lexical-query";
import { fuseRoomFileCandidates, type Candidate } from "./hybrid";
type RpcResult = { data: unknown; error: unknown };
type RpcRequest = PromiseLike<RpcResult> & { abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult> };
export type FileSearchClient = { rpc: (name: string, args: Record<string, unknown>) => RpcRequest };
async function boundedRpc(client: FileSearchClient, name: string, args: Record<string, unknown>) {
  const request = client.rpc(name, args);
  return await (request.abortSignal ? request.abortSignal(AbortSignal.timeout(2000)) : request);
}
function candidates(data: unknown): Candidate[] {
  if (!Array.isArray(data)) return [];
  return data.filter((c): c is Candidate => c && typeof c.file_id === "string" && Number.isInteger(c.chunk_index) && typeof c.content === "string" && typeof c.original_name === "string").slice(0, 10);
}
export async function searchRoomFiles(client: FileSearchClient, roomId: string, query: string, excludedFileIds: string[] = [], onLexicalFailure: () => void = () => {}) {
  if (!query.trim()) return [];
  const lexicalQuery = buildLexicalSearchQuery(query);
  const lexicalTask = (async () => {
    try {
      if (!lexicalQuery) return [];
      const result = await boundedRpc(client, "search_room_file_chunks", { p_room_id: roomId, p_query: lexicalQuery, p_limit: 10 });
      if (result.error) { onLexicalFailure(); return []; }
      return candidates(result.data);
    } catch { onLexicalFailure(); return []; }
  })();
  const semanticTask = (async () => {
    try {
      const [embedding] = await embedFileTexts([query.slice(0, 2000)]);
      const result = await boundedRpc(client, "search_room_file_chunks_semantic", { p_room_id: roomId, p_embedding: JSON.stringify(embedding), p_limit: 10 });
      return result.error ? [] : candidates(result.data);
    } catch { return []; }
  })();
  const [lexical, semantic] = await Promise.all([lexicalTask, semanticTask]);
  try { return fuseRoomFileCandidates(query, lexical, semantic, true, excludedFileIds); } catch { return lexical.slice(0, 5).filter((c) => !excludedFileIds.includes(c.file_id)); }
}

/** Explicit maintenance operation: one owner/Room-scoped batch, at most 20 rows. */
export async function backfillRoomFileEmbeddings(client: FileSearchClient, roomId: string, limit = 20) {
  const bounded = Math.min(20, Math.max(0, Math.trunc(limit)));
  if (!Number.isFinite(bounded) || !bounded) return 0;
  const pending = await boundedRpc(client, "missing_room_file_embeddings", { p_room_id: roomId, p_limit: bounded });
  if (pending.error) throw new Error("Backfill unavailable");
  const rows = (pending.data ?? []) as { id: string; content: string }[];
  if (!rows.length) return 0;
  const vectors = await embedFileTexts(rows.map((row) => row.content));
  const saved = await boundedRpc(client, "fill_room_file_embeddings", { p_room_id: roomId, p_rows: rows.map((row, i) => ({ id: row.id, embedding: vectors[i] })) });
  if (saved.error) throw new Error("Backfill unavailable");
  return Number(saved.data ?? 0);
}
