import type { ChatModel } from "@/lib/chat/validation";
import type { ResearchRunMetrics } from "@/lib/research/types";
import { SEARCH_UNIT_USD_MICROS, type UsdMicros } from "@/lib/usage/pricing";
import {
  estimateUsageFromText,
  withCostEstimate,
  type ProviderTokenUsage,
} from "@/lib/usage/provider-usage";

/**
 * Conservative estimated chars for a Deep Research planner model call when the
 * provider omits usage. Explicit estimate — not a live invoice.
 */
export const RESEARCH_PLANNER_PROMPT_CHARS = 2_400;
export const RESEARCH_PLANNER_OUTPUT_CHARS = 1_200;

export type ResearchSpendBreakdown = {
  plannerMicros: UsdMicros;
  searchMicros: UsdMicros;
  synthesisMicros: UsdMicros;
  actualMicros: UsdMicros;
  upstreamModelCalls: number;
  searchQueryCount: number;
  synthesisStarted: boolean;
};

/**
 * Dollar actualization for Deep Research: planner model calls + search units +
 * synthesis tokens. Upstream stages must not silently refund reserved overhead.
 */
export function estimateResearchSpendMicros(input: {
  synthesisMode: ChatModel;
  planMode: ChatModel;
  metrics: Pick<ResearchRunMetrics, "modelCallCount" | "searchQueryCount">;
  synthesisUsage?: ProviderTokenUsage | null;
  synthesisPromptChars?: number;
  synthesisOutputChars?: number;
  /** True once the synthesis provider stream was requested. */
  synthesisStarted?: boolean;
}): ResearchSpendBreakdown {
  const upstreamModelCalls = Math.max(0, Math.trunc(input.metrics.modelCallCount));
  const searchQueryCount = Math.max(0, Math.trunc(input.metrics.searchQueryCount));
  const synthesisStarted = Boolean(input.synthesisStarted);

  const plannerCall = withCostEstimate(
    input.planMode,
    estimateUsageFromText({
      promptChars: RESEARCH_PLANNER_PROMPT_CHARS,
      outputChars: RESEARCH_PLANNER_OUTPUT_CHARS,
    }),
  );
  const plannerMicros = upstreamModelCalls * plannerCall.estimatedUsdMicros;
  const searchMicros = searchQueryCount * SEARCH_UNIT_USD_MICROS;

  let synthesisMicros: UsdMicros = 0;
  if (synthesisStarted) {
    const usage =
      input.synthesisUsage
      ?? estimateUsageFromText({
        promptChars: Math.max(0, input.synthesisPromptChars ?? 8_000),
        outputChars: Math.max(0, input.synthesisOutputChars ?? 0),
      });
    synthesisMicros = withCostEstimate(input.synthesisMode, usage).estimatedUsdMicros;
  }

  return {
    plannerMicros,
    searchMicros,
    synthesisMicros,
    actualMicros: Math.max(0, plannerMicros + searchMicros + synthesisMicros),
    upstreamModelCalls,
    searchQueryCount,
    synthesisStarted,
  };
}
