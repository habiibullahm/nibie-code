import type { ChatModel } from "@/lib/chat/validation";
import { estimateTokenCostMicros, type UsdMicros } from "@/lib/usage/pricing";

export type TokenUsageSource = "provider" | "estimated";

export type ProviderTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  source: TokenUsageSource;
};

export type GenerationCostEstimate = ProviderTokenUsage & {
  estimatedUsdMicros: UsdMicros;
  estimatedUsd: number;
};

type RawProviderUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  reasoning_tokens?: unknown;
  completion_tokens_details?: { reasoning_tokens?: unknown } | null;
  prompt_tokens_details?: unknown;
};

function nonNegInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n >= 0 && Number.isSafeInteger(n) ? n : null;
}

/** Normalize an OpenAI-compatible `usage` object. Returns null when unusable. */
export function extractProviderUsage(raw: unknown): ProviderTokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as RawProviderUsage;
  const input = nonNegInt(usage.prompt_tokens) ?? nonNegInt(usage.input_tokens);
  const output = nonNegInt(usage.completion_tokens) ?? nonNegInt(usage.output_tokens);
  if (input === null && output === null) return null;
  const reasoning =
    nonNegInt(usage.reasoning_tokens)
    ?? nonNegInt(usage.completion_tokens_details?.reasoning_tokens)
    ?? 0;
  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  const total = nonNegInt(usage.total_tokens) ?? inputTokens + outputTokens + reasoning;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: reasoning,
    totalTokens: total,
    source: "provider",
  };
}

/** Char-heuristic estimate when the provider omits usage (marked estimated). */
export function estimateUsageFromText(input: {
  promptChars: number;
  outputChars: number;
  reasoningChars?: number;
}): ProviderTokenUsage {
  const inputTokens = estimateTokensFromChars(input.promptChars);
  const outputTokens = estimateTokensFromChars(input.outputChars);
  const reasoningTokens = estimateTokensFromChars(input.reasoningChars ?? 0);
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens,
    source: "estimated",
  };
}

/** Same heuristic as `lib/context/token-budget` (≈4 chars/token) without allocating giant strings. */
function estimateTokensFromChars(chars: number): number {
  const n = Math.max(0, Math.trunc(chars));
  return Math.ceil(n / 4);
}

export function withCostEstimate(mode: ChatModel, usage: ProviderTokenUsage): GenerationCostEstimate {
  const estimatedUsdMicros = estimateTokenCostMicros({
    mode,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
  });
  return {
    ...usage,
    estimatedUsdMicros,
    estimatedUsd: estimatedUsdMicros / 1_000_000,
  };
}

export function mergeUsage(primary: ProviderTokenUsage | null | undefined, fallback: ProviderTokenUsage): ProviderTokenUsage {
  return primary ?? fallback;
}
