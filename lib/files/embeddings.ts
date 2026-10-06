import "server-only";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
/** Default for upload/backfill batches. Query-time search uses a tighter budget. */
export const EMBEDDING_TIMEOUT_MS = 5000;
export const QUERY_EMBEDDING_TIMEOUT_MS = 1500;
export const UPLOAD_EMBEDDING_TIMEOUT_MS = 2000;

export function embeddingKeyConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function validEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS && value.every((n) => typeof n === "number" && Number.isFinite(n)) && value.some((n) => n !== 0);
}

/** One bounded request, no retries and no provider response/input logging. */
export async function embedFileTexts(input: string[], options?: { timeoutMs?: number }): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Embedding unavailable");
  if (!input.length || input.length > 20 || input.some((s) => !s.trim() || s.length > 3000)) throw new Error("Invalid embedding batch");
  const timeoutMs = options?.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float", input }),
  });
  if (!response.ok) throw new Error("Embedding unavailable");
  const body = await response.json() as { data?: { index: number; embedding: unknown }[] };
  const rows = body.data;
  if (!Array.isArray(rows) || rows.length !== input.length) throw new Error("Invalid embeddings");
  const ordered: number[][] = [];
  for (const row of rows) {
    if (!Number.isInteger(row.index) || row.index < 0 || row.index >= input.length || ordered[row.index] || !validEmbedding(row.embedding)) throw new Error("Invalid embeddings");
    ordered[row.index] = row.embedding;
  }
  return ordered;
}
