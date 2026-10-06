import "server-only";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
export function validEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS && value.every((n) => typeof n === "number" && Number.isFinite(n)) && value.some((n) => n !== 0);
}

/** One bounded request, no retries and no provider response/input logging. */
export async function embedFileTexts(input: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Embedding unavailable");
  if (!input.length || input.length > 20 || input.some((s) => !s.trim() || s.length > 3000)) throw new Error("Invalid embedding batch");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", signal: AbortSignal.timeout(5000),
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
