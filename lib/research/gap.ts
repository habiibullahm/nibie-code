import { RESEARCH_MAX_FOLLOWUP_QUERIES } from "@/lib/research/budgets";
import type { ResearchEvidenceChunk, ResearchPlan } from "@/lib/research/types";

export type ResearchGapResult = {
  needsFollowUp: boolean;
  followUpQueries: string[];
  reason: string;
};

function clean(value: string): string | null {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length < 2 || trimmed.length > 240) return null;
  return trimmed;
}

/**
 * Deterministic gap detection after the initial gather.
 * At most one follow-up round; queries bounded ≤4.
 */
export function detectResearchGaps(
  plan: ResearchPlan,
  evidence: readonly ResearchEvidenceChunk[],
): ResearchGapResult {
  if (evidence.length === 0) {
    const followUpQueries = plan.initialQueries
      .slice(0, RESEARCH_MAX_FOLLOWUP_QUERIES)
      .map((q) => clean(`${q} official documentation`) ?? q)
      .slice(0, RESEARCH_MAX_FOLLOWUP_QUERIES);
    return {
      needsFollowUp: followUpQueries.length > 0,
      followUpQueries,
      reason: "no_evidence",
    };
  }

  const domains = new Set(evidence.map((e) => e.domain.toLowerCase()));
  const textBlob = evidence.map((e) => `${e.title} ${e.text}`).join("\n").toLowerCase();
  const uncovered = plan.subquestions.filter((sq) => {
    const tokens = sq.toLowerCase().split(/\W+/).filter((t) => t.length > 3).slice(0, 4);
    if (!tokens.length) return false;
    const hits = tokens.filter((t) => textBlob.includes(t)).length;
    return hits < Math.ceil(tokens.length / 2);
  });

  const thinCoverage = evidence.length < 3 || domains.size < 2;
  const needsFollowUp = uncovered.length > 0 || thinCoverage;
  if (!needsFollowUp) {
    return { needsFollowUp: false, followUpQueries: [], reason: "sufficient" };
  }

  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (q: string | null) => {
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(q);
  };

  for (const sq of uncovered) {
    push(clean(`${sq} primary source`));
    if (queries.length >= RESEARCH_MAX_FOLLOWUP_QUERIES) break;
  }
  if (thinCoverage) {
    push(clean(`${plan.normalizedQuestion} comparison review`));
    push(clean(`${plan.normalizedQuestion} official docs`));
  }
  if (plan.timeSensitive) {
    push(clean(`${plan.normalizedQuestion} ${new Date().getUTCFullYear()}`));
  }

  return {
    needsFollowUp: queries.length > 0,
    followUpQueries: queries.slice(0, RESEARCH_MAX_FOLLOWUP_QUERIES),
    reason: uncovered.length ? "uncovered_subquestions" : "thin_coverage",
  };
}
