import type { ResearchUsagePolicy } from "@/lib/research/types";
import { RESEARCH_CREDIT_OVERHEAD, researchCreditCost } from "@/lib/usage/policy";

/**
 * Deep Research metering policy (Cost Guard).
 *
 * Credits reserve `researchCreditCost[mode]` = synthesis mode cost + fixed multi-call
 * overhead (planner + follow-up + search/fetch budget). Distinct from chat mode credits
 * so multi-call research cannot undercount as one mode credit.
 */
export const RESEARCH_USAGE_POLICY: ResearchUsagePolicy = {
  id: "research_metered_v1",
  summary:
    `Deep Research reserves synthesis mode credits plus a ${RESEARCH_CREDIT_OVERHEAD}-credit multi-call overhead (planner, follow-up, search/fetch). Fast/Balanced/High research costs are ${researchCreditCost.Fast}/${researchCreditCost.Balanced}/${researchCreditCost.High}.`,
};

export function researchUsagePolicyFields() {
  return {
    researchUsagePolicy: RESEARCH_USAGE_POLICY.id,
    researchUsageHonest: true as const,
  };
}
