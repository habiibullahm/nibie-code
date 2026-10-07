import type { MemoryRecord, MemoryType, RankedMemory } from "@/lib/recall/types";

const IDENTIFIER = /\b[A-Z]{2,}(?:[A-Z0-9._-]*)\b|\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b|\b(?:v?\d+\.\d+(?:\.\d+)?)\b/g;

const CODING_QUERY = /\b(code|coding|typescript|javascript|react|sql|api|deploy|git|bug|fix|implement|function|class|module)\b/i;

const TYPE_WEIGHT: Record<MemoryType, number> = {
  instruction: 1.15,
  preference: 1.1,
  project: 1.05,
  fact: 1,
};

export function extractIdentifiers(text: string) {
  return [...text.matchAll(IDENTIFIER)].map((match) => match[0].toLowerCase());
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "in", "on", "at", "to", "for", "from", "by", "with", "as", "and", "or",
  "what", "where", "when", "why", "how", "which", "who", "do", "does", "did",
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "this", "that",
  "ada", "yang", "dan", "atau", "di", "ke", "dari", "untuk", "apa", "bagaimana",
]);

function tokenSet(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
  );
}

function overlapScore(queryTokens: Set<string>, content: string) {
  const contentTokens = tokenSet(content);
  if (!queryTokens.size || !contentTokens.size) return 0;
  let hit = 0;
  for (const token of queryTokens) if (contentTokens.has(token)) hit += 1;
  return hit / queryTokens.size;
}

/** Lightweight ranking: exact identifiers first, then lexical relevance, with type boosts for coding queries. */
export function rankMemories(query: string, memories: MemoryRecord[], limit: number): RankedMemory[] {
  const queryTokens = tokenSet(query);
  const identifiers = extractIdentifiers(query);
  const coding = CODING_QUERY.test(query);
  const ranked: RankedMemory[] = [];

  for (const memory of memories) {
    if (!memory.isActive) continue;
    const contentLower = memory.content.toLowerCase();
    const keyLower = memory.normalizedKey.toLowerCase();
    const exactIdentifier = identifiers.some((id) => contentLower.includes(id) || keyLower.includes(id));
    const lexical = overlapScore(queryTokens, memory.content);
    if (!exactIdentifier && lexical <= 0) continue;
    let score = lexical;
    if (exactIdentifier) score += 2;
    if (coding) score *= TYPE_WEIGHT[memory.type];
    else if (memory.type === "preference" || memory.type === "instruction") score *= 1.05;
    ranked.push({ ...memory, score, exactIdentifier });
  }

  ranked.sort((a, b) => {
    if (a.exactIdentifier !== b.exactIdentifier) return a.exactIdentifier ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return ranked.slice(0, Math.max(0, limit));
}
