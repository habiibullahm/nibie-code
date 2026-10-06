import { buildLexicalSearchQuery } from "../../lib/files/lexical-query";
import { fuseRoomFileCandidates, type Candidate } from "../../lib/files/hybrid";

// Hand-authored, normalized fixture vectors. These are NOT OpenAI embeddings.
export const vector = (axis: number, strength = 1) => {
  const values = Array<number>(512).fill(0);
  values[axis] = strength;
  values[511] = Math.sqrt(1 - strength * strength);
  return values;
};
const documents: readonly (readonly [string, string, number])[] = [
  ["deploy", "The deployment pipeline releases the backend service after validation.", 0],
  ["auth", "The login middleware verifies bearer credentials before granting access.", 1],
  ["cache", "Expired cache entries are removed every sixty seconds.", 2],
  ["symbol", "function releaseBackend_v2() validates the build and deploys it.", 3],
  ...Array.from({ length: 8 }, (_, i) => [`distractor-${i}`, "The backend service backend service reports service health. Release helpers validate workloads.", 4] as const),
] as const;
export const fixtureDocuments = documents.map(([id, content, axis]) => ({
  file_id: id, chunk_index: 0, original_name: `${id}.txt`, content, extracted_truncated: false, embedding: vector(Number(axis)),
}));
export const fixtureCases = [
  { kind: "paraphrase", query: "How is the backend shipped to production?", relevant: ["deploy"], embedding: vector(0, 0.9) },
  { kind: "paraphrase", query: "How are users authenticated?", relevant: ["auth"], embedding: vector(1, 0.9) },
  { kind: "paraphrase", query: "When does stale cached data disappear?", relevant: ["cache"], embedding: vector(2, 0.9) },
  { kind: "exact", query: "Explain releaseBackend_v2", relevant: ["symbol"], embedding: vector(4, 0.95) },
  { kind: "exact", query: "Explain missingBackend_v9", relevant: [], embedding: vector(3, 0.95) },
  { kind: "no-answer", query: "What is the cafeteria lunch menu?", relevant: [], embedding: vector(0, 0.5) },
  { kind: "no-answer", query: "Who won the chess tournament?", relevant: [], embedding: vector(6) },
];
export function fixturePools(test: typeof fixtureCases[number]) {
  const terms = buildLexicalSearchQuery(test.query)?.split(" OR ") ?? [];
  // Deterministic simple-token lexical approximation; SQL/RLS is tested separately.
  const lexical = fixtureDocuments.map((doc) => ({ doc, score: terms.reduce((score, term) => score + doc.content.toLowerCase().split(/\W+/).filter((word) => word === term).length, 0) }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.doc.file_id.localeCompare(b.doc.file_id)).slice(0, 10).map(({ doc }) => doc);
  const semantic: Candidate[] = fixtureDocuments.map((doc) => ({ ...doc, similarity: doc.embedding.reduce((sum, v, i) => sum + v * test.embedding[i], 0) }))
    .sort((a, b) => b.similarity! - a.similarity! || a.file_id.localeCompare(b.file_id)).slice(0, 10);
  return { lexical, semantic };
}
export function evaluateFixtures() {
  return ["lexical", "semantic", "hybrid", "hybrid+rerank"].map((mode) => {
    let recall = 0, reciprocal = 0, positives = 0, falsePositives = 0, negatives = 0;
    const ranks: { kind: string; query: string; firstRelevantRank: number | null; returned: number }[] = [];
    const start = performance.now();
    for (const test of fixtureCases) {
      const { lexical, semantic } = fixturePools(test);
      const results = mode === "lexical" ? lexical.slice(0, 5) : mode === "semantic" ? semantic.slice(0, 5) : fuseRoomFileCandidates(test.query, lexical, semantic, mode === "hybrid+rerank");
      const rank = results.findIndex((c) => test.relevant.includes(c.file_id));
      if (test.relevant.length) { positives++; recall += results.filter((c) => test.relevant.includes(c.file_id)).length / test.relevant.length; reciprocal += rank < 0 ? 0 : 1 / (rank + 1); }
      else { negatives++; falsePositives += Number(results.length > 0); }
      ranks.push({ kind: test.kind, query: test.query, firstRelevantRank: rank < 0 ? null : rank + 1, returned: results.length });
    }
    return { mode, recallAt5: recall / positives, mrr: reciprocal / positives, noAnswerFalsePositives: `${falsePositives}/${negatives}`, localRankingFusionMs: performance.now() - start, ranks };
  });
}
