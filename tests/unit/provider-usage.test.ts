import { describe, expect, it } from "vitest";
import {
  estimateUsageFromText,
  extractProviderUsage,
  withCostEstimate,
} from "@/lib/usage/provider-usage";
import { creditCostFor, researchCreditCost, weeklyCreditCost, RESEARCH_CREDIT_OVERHEAD } from "@/lib/usage/policy";
import { getSpendLimits, spendReservationMicros } from "@/lib/usage/spend-policy";
import { reserveSpendCeilingMicros } from "@/lib/usage/pricing";
import { RESEARCH_USAGE_POLICY } from "@/lib/research/usage-policy";

describe("provider usage accounting", () => {
  it("extracts actual provider tokens including reasoning", () => {
    expect(extractProviderUsage({
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 155,
      completion_tokens_details: { reasoning_tokens: 15 },
    })).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      reasoningTokens: 15,
      totalTokens: 155,
      source: "provider",
    });
  });

  it("returns null for unusable usage payloads", () => {
    expect(extractProviderUsage(null)).toBeNull();
    expect(extractProviderUsage({})).toBeNull();
  });

  it("marks char heuristics as estimated", () => {
    const usage = estimateUsageFromText({ promptChars: 40, outputChars: 8 });
    expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 2, source: "estimated" });
  });

  it("estimates USD micros from High above Balanced for the same tokens", () => {
    const tokens = { inputTokens: 1_000_000, outputTokens: 0, reasoningTokens: 0, totalTokens: 1_000_000, source: "provider" as const };
    const balanced = withCostEstimate("Balanced", tokens);
    const high = withCostEstimate("High", tokens);
    expect(high.estimatedUsdMicros).toBeGreaterThan(balanced.estimatedUsdMicros * 10);
  });
});

describe("research and spend policy", () => {
  it("charges research above a single mode credit", () => {
    expect(RESEARCH_CREDIT_OVERHEAD).toBe(6);
    expect(researchCreditCost.Fast).toBe(weeklyCreditCost.Fast + 6);
    expect(creditCostFor("High", "research")).toBe(12);
    expect(creditCostFor("High", "chat")).toBe(6);
    expect(RESEARCH_USAGE_POLICY.id).toBe("research_metered_v1");
  });

  it("reserves a higher spend ceiling for research and High mode", () => {
    expect(spendReservationMicros("High", "research")).toBe(
      reserveSpendCeilingMicros("High", "research"),
    );
    expect(spendReservationMicros("High", "research")).toBeGreaterThan(spendReservationMicros("High", "chat"));
    expect(spendReservationMicros("High", "chat")).toBeGreaterThan(spendReservationMicros("Fast", "chat"));
  });

  it("defaults spend limits and fails closed at explicit zero", () => {
    expect(getSpendLimits({}).userDailyUsdMicros).toBe(5_000_000);
    expect(getSpendLimits({ AI_SPEND_LIMIT_USER_DAILY_USD: "0" }).userDailyUsdMicros).toBe(0);
  });
});
