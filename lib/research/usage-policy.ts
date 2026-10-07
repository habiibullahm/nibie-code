import type { ResearchUsagePolicy } from "@/lib/research/types";

/**
 * Temporary Deep Research metering policy (V1).
 *
 * Credits still reserve once via the selected Fast/Balanced/High mode for the
 * final synthesis stream. Planner + optional follow-up model calls and multi-query
 * search/fetch are NOT separately charged yet — that undercounts true cost.
 * Observability reports modelCallCount, searchQueryCount, pagesFetched, durationMs.
 * Do not pretend credits fully meter Deep Research until a dedicated weight lands.
 */
export const RESEARCH_USAGE_POLICY: ResearchUsagePolicy = {
  id: "temporary_undercount_v1",
  summary:
    "Deep Research V1 charges the selected mode once for synthesis only; planner/follow-up model calls and multi-query search/fetch are undercounted until a dedicated credit weight ships.",
};

export function researchUsagePolicyFields() {
  return {
    researchUsagePolicy: RESEARCH_USAGE_POLICY.id,
    researchUsageHonest: true as const,
  };
}
