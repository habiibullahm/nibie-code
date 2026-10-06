import type { RoomFileMatch } from "./retrieval";
import { buildLexicalSearchQuery } from "./lexical-query";

export type Candidate = RoomFileMatch & { similarity?: number };
export const SEMANTIC_MIN_SIMILARITY = 0.55;
const key = (c: Candidate) => `${c.file_id}:${c.chunk_index}`;
export function queryIdentifiers(query: string) {
  const tokens = (query.match(/[A-Za-z0-9_][A-Za-z0-9_.:/-]*/g) ?? []).map((s) => s.replace(/[.:/-]+$/, ""));
  const quoted = [...query.matchAll(/`([A-Za-z0-9_][A-Za-z0-9_.:/-]*)`/g)].map((m) => m[1]);
  const calls = [...query.matchAll(/(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((m) => m[1]);
  return [...new Set([...quoted, ...calls, ...tokens.filter((s) => /[_./:-]|[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]|^[A-Z]{2,}$/.test(s))])];
}
function hasIdentifier(c: Candidate, identifier: string) {
  return new RegExp(`(?<![A-Za-z0-9_])${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`).test(c.content + " " + c.original_name);
}

/** RRF uses list position, never mixes incomparable lexical/cosine scores. */
export function fuseRoomFileCandidates(query: string, lexical: Candidate[], semantic: Candidate[], rerank = true, excludedFileIds: string[] = []) {
  const identifiers = queryIdentifiers(query);
  const entries = new Map<string, { candidate: Candidate; score: number; exact: number; similarity: number }>();
  for (const [pool, isLexical] of [[lexical, true], [semantic, false]] as const) {
    const seen = new Set<string>();
    pool.slice(0, 10).forEach((candidate, i) => {
      const id = key(candidate);
      if (seen.has(id) || excludedFileIds.includes(candidate.file_id)) return;
      seen.add(id);
      const exact = identifiers.filter((s) => hasIdentifier(candidate, s)).length;
      // Identifier questions cannot acquire fuzzy context for another symbol.
      if (identifiers.length && exact !== identifiers.length) return;
      if (!isLexical && !lexical.some((c) => key(c) === id) && (!Number.isFinite(candidate.similarity) || candidate.similarity! < SEMANTIC_MIN_SIMILARITY)) return;
      const entry = entries.get(id) ?? { candidate, score: 0, exact, similarity: 0 };
      entry.score += 1 / (60 + i + 1);
      if (!isLexical && Number.isFinite(candidate.similarity)) entry.similarity = candidate.similarity!;
      entries.set(id, entry);
    });
  }
  const terms = buildLexicalSearchQuery(query)?.split(" OR ") ?? [];
  const coverage = (c: Candidate) => terms.filter((term) => c.content.toLowerCase().includes(term)).length;
  // A small, bounded evidence bonus breaks RRF near-ties without replacing fusion.
  const evidenceBonus = (similarity: number) => 0.005 * Math.max(0, Math.min(1, similarity) - SEMANTIC_MIN_SIMILARITY);
  return [...entries.values()].sort((a, b) =>
    (rerank ? b.exact - a.exact : 0) ||
    (b.score + (rerank ? evidenceBonus(b.similarity) : 0)) - (a.score + (rerank ? evidenceBonus(a.similarity) : 0)) ||
    (rerank ? coverage(b.candidate) - coverage(a.candidate) : 0) ||
    key(a.candidate).localeCompare(key(b.candidate), "en")
  ).slice(0, 5).map((entry) => entry.candidate);
}
