import { describe, expect, it } from "vitest";
import {
  estimateResearchSpendMicros,
  RESEARCH_PLANNER_OUTPUT_CHARS,
  RESEARCH_PLANNER_PROMPT_CHARS,
} from "@/lib/usage/research-spend";
import { SEARCH_UNIT_USD_MICROS } from "@/lib/usage/pricing";
import { estimateUsageFromText, withCostEstimate } from "@/lib/usage/provider-usage";

describe("Deep Research dollar spend actualization", () => {
  it("charges planner calls and search units before synthesis", () => {
    const planner = withCostEstimate(
      "Fast",
      estimateUsageFromText({
        promptChars: RESEARCH_PLANNER_PROMPT_CHARS,
        outputChars: RESEARCH_PLANNER_OUTPUT_CHARS,
      }),
    );
    const breakdown = estimateResearchSpendMicros({
      synthesisMode: "Balanced",
      planMode: "Fast",
      metrics: { modelCallCount: 1, searchQueryCount: 3 },
      synthesisStarted: false,
    });
    expect(breakdown.plannerMicros).toBe(planner.estimatedUsdMicros);
    expect(breakdown.searchMicros).toBe(3 * SEARCH_UNIT_USD_MICROS);
    expect(breakdown.synthesisMicros).toBe(0);
    expect(breakdown.actualMicros).toBe(planner.estimatedUsdMicros + 3 * SEARCH_UNIT_USD_MICROS);
  });

  it("adds synthesis tokens on top of upstream costs for a full multi-call fixture", () => {
    const synthesisUsage = {
      inputTokens: 2_000,
      outputTokens: 500,
      reasoningTokens: 0,
      totalTokens: 2_500,
      source: "provider" as const,
    };
    const synthesis = withCostEstimate("Balanced", synthesisUsage);
    const planner = withCostEstimate(
      "Fast",
      estimateUsageFromText({
        promptChars: RESEARCH_PLANNER_PROMPT_CHARS,
        outputChars: RESEARCH_PLANNER_OUTPUT_CHARS,
      }),
    );
    const breakdown = estimateResearchSpendMicros({
      synthesisMode: "Balanced",
      planMode: "Fast",
      metrics: { modelCallCount: 2, searchQueryCount: 5 },
      synthesisUsage,
      synthesisStarted: true,
    });
    expect(breakdown.upstreamModelCalls).toBe(2);
    expect(breakdown.searchQueryCount).toBe(5);
    expect(breakdown.actualMicros).toBe(
      2 * planner.estimatedUsdMicros + 5 * SEARCH_UNIT_USD_MICROS + synthesis.estimatedUsdMicros,
    );
    // Must exceed synthesis-only undercount that previously refunded research overhead.
    expect(breakdown.actualMicros).toBeGreaterThan(synthesis.estimatedUsdMicros);
  });

  it("keeps stop/fail after gather from charging synthesis while retaining upstream spend", () => {
    const stopped = estimateResearchSpendMicros({
      synthesisMode: "High",
      planMode: "Fast",
      metrics: { modelCallCount: 1, searchQueryCount: 2 },
      synthesisStarted: false,
    });
    expect(stopped.synthesisMicros).toBe(0);
    expect(stopped.actualMicros).toBeGreaterThan(0);
    expect(stopped.searchMicros).toBe(2 * SEARCH_UNIT_USD_MICROS);
  });
});
