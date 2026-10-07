import { RESEARCH_EVIDENCE_CHARS_MAX } from "@/lib/research/budgets";
import type { ResearchContradiction, ResearchEvidenceChunk } from "@/lib/research/types";
import type { WebContextInput } from "@/lib/web/types";

/** Bound page text into an evidence chunk — never dump whole pages into synthesis. */
export function extractEvidenceChunk(
  source: WebContextInput,
  maxChars: number = RESEARCH_EVIDENCE_CHARS_MAX,
): ResearchEvidenceChunk {
  const limit = Math.max(200, Math.trunc(maxChars));
  let text = source.text.replace(/\s+/g, " ").trim();
  if (text.length > limit) {
    text = `${text.slice(0, limit).trimEnd()}…`;
  }
  return {
    url: source.url,
    title: source.title,
    domain: source.domain,
    publishedAt: source.publishedAt ?? null,
    text,
    retrieval: source.retrieval,
  };
}

export function evidenceToWebContext(chunks: readonly ResearchEvidenceChunk[]): WebContextInput[] {
  return chunks.map((chunk) => ({
    url: chunk.url,
    title: chunk.title,
    domain: chunk.domain,
    publishedAt: chunk.publishedAt ?? null,
    retrieval: chunk.retrieval,
    text: chunk.text,
  }));
}

const CONFLICT_CUES = [
  { topic: "pricing", pattern: /\b(price|pricing|cost|\$|usd|eur|subscription|plan)\b/i },
  { topic: "regulation", pattern: /\b(regulat|compliance|gdpr|hipaa|legal|law|banned|illegal)\b/i },
  { topic: "benchmarks", pattern: /\b(benchmark|latency|throughput|score|tokens\/s|accuracy|mmlu)\b/i },
  { topic: "market", pattern: /\b(market share|revenue|arr|valuation|growth|competitors?)\b/i },
  { topic: "capabilities", pattern: /\b(supports?|does not support|cannot|limited to|available in|feature)\b/i },
] as const;

/**
 * Heuristic surface of material disagreement across evidence texts.
 * Not a knowledge graph — just flags topics where sources likely conflict for the synthesizer.
 */
export function detectContradictions(chunks: readonly ResearchEvidenceChunk[]): ResearchContradiction[] {
  if (chunks.length < 2) return [];
  const found: ResearchContradiction[] = [];
  for (const cue of CONFLICT_CUES) {
    const matching = chunks.filter((chunk) => cue.pattern.test(chunk.text) || cue.pattern.test(chunk.title));
    if (matching.length < 2) continue;
    const domains = [...new Set(matching.map((c) => c.domain))];
    if (domains.length < 2) continue;
    found.push({
      topic: cue.topic,
      summary: `Multiple sources discuss ${cue.topic} (${domains.slice(0, 4).join(", ")}). Compare claims carefully and cite each side.`,
    });
  }
  return found;
}
