/** Conversational filler that causes AND-style tsquery misses on natural questions. */
const LEXICAL_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "as", "at", "by", "for", "from", "in", "into", "of", "on", "to", "with", "about", "than",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "doing", "done",
  "have", "has", "had", "having",
  "what", "which", "who", "whom", "whose", "where", "when", "why", "how",
  "this", "that", "these", "those", "there", "here",
  "i", "me", "my", "we", "our", "ours", "you", "your", "yours", "it", "its", "they", "them", "their", "theirs",
  "can", "could", "should", "would", "will", "shall", "may", "might", "must",
  "just", "also", "any", "all", "each", "few", "more", "most", "other", "some", "such", "no", "not", "only", "own", "same", "too", "very",
  "please", "tell", "give", "explain", "describe", "show", "list", "get", "make", "need", "want", "know", "think", "like", "use", "using", "used",
]);

const MAX_LEXICAL_TERMS = 16;

/** Escape a term for websearch OR clauses / to_tsquery. */
function escapeTsQueryTerm(term: string) {
  return term.replace(/([|&!():*<->\\])/g, "\\$1");
}

/**
 * Turn a natural-language chat message into a deterministic OR websearch query.
 * Dropping question filler keeps recall for phrases like "What does our deployment pipeline do?"
 * while ranking still prefers chunks that match more content terms.
 */
export function buildLexicalSearchQuery(raw: string): string | null {
  const source = raw.trim().slice(0, 2000);
  if (!source) return null;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const match of source.matchAll(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g)) {
    const term = match[0].toLowerCase();
    if (LEXICAL_STOPWORDS.has(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_LEXICAL_TERMS) break;
  }
  if (!terms.length) return null;
  return terms.map(escapeTsQueryTerm).join(" OR ");
}
