import type { ChatModel } from "@/lib/chat/validation";
import type { UsageKind } from "@/lib/usage/policy";

/** USD micros: $1.00 = 1_000_000. Integer-only to avoid float money math. */
export type UsdMicros = number;

export type ModePricing = {
  /** Estimated USD per 1M input tokens (including cached-miss). Explicit estimate, not a live quote. */
  inputPerMillionUsd: number;
  /** Estimated USD per 1M output tokens. */
  outputPerMillionUsd: number;
  /** Estimated USD per 1M reasoning tokens when the provider reports them separately. */
  reasoningPerMillionUsd: number;
};

/**
 * Nibie budget estimates for spend protection. Marked estimated — not billed invoices.
 * High (Sol-class) is intentionally ~20× Balanced so free credits cannot silently burn dollars.
 */
export const modePricingUsd: Readonly<Record<ChatModel, ModePricing>> = {
  Fast: { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, reasoningPerMillionUsd: 0.28 },
  Balanced: { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10, reasoningPerMillionUsd: 10 },
  High: { inputPerMillionUsd: 25, outputPerMillionUsd: 200, reasoningPerMillionUsd: 200 },
};

/** Estimated Tavily-class search unit for research metering (USD micros). */
export const SEARCH_UNIT_USD_MICROS = 8_000; // $0.008

/** Conservative ceiling reserved before a generation so expensive modes cannot bypass the budget. */
export const spendReserveCeilingMicros: Readonly<Record<ChatModel, UsdMicros>> = {
  Fast: 20_000, // $0.02
  Balanced: 150_000, // $0.15
  High: 2_500_000, // $2.50
};

/** Extra research overhead reserved on top of the mode ceiling (planner + follow-up + multi-search). */
export const RESEARCH_SPEND_OVERHEAD_MICROS = 80_000; // $0.08

export function usdToMicros(usd: number): UsdMicros {
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError("usd must be a non-negative finite number");
  return Math.round(usd * 1_000_000);
}

export function microsToUsd(micros: UsdMicros): number {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new RangeError("micros must be a non-negative safe integer");
  return micros / 1_000_000;
}

export function estimateTokenCostMicros(input: {
  mode: ChatModel;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
}): UsdMicros {
  const pricing = modePricingUsd[input.mode];
  const inputCost = (Math.max(0, input.inputTokens) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = (Math.max(0, input.outputTokens) / 1_000_000) * pricing.outputPerMillionUsd;
  const reasoningCost = (Math.max(0, input.reasoningTokens ?? 0) / 1_000_000) * pricing.reasoningPerMillionUsd;
  return usdToMicros(inputCost + outputCost + reasoningCost);
}

export function reserveSpendCeilingMicros(mode: ChatModel, kind: UsageKind): UsdMicros {
  const base = spendReserveCeilingMicros[mode];
  return kind === "research" ? base + RESEARCH_SPEND_OVERHEAD_MICROS : base;
}

/** Provider id is recorded for telemetry only; pricing is keyed by logical mode. */
export function pricingModeForProvider(_provider: string | null, mode: ChatModel): ChatModel {
  return mode;
}
