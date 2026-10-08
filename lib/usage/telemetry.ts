import "server-only";

import type { ChatModel } from "@/lib/chat/validation";
import type { ProviderId } from "@/lib/ai/registry";
import { logInfo } from "@/lib/observability/logger";
import type { GenerationCostEstimate } from "@/lib/usage/provider-usage";
import type { UsageKind } from "@/lib/usage/policy";

export type FailureCategory =
  | "none"
  | "provider"
  | "timeout"
  | "abort"
  | "quota"
  | "spend"
  | "persist"
  | "context"
  | "research"
  | "stream"
  | "unknown";

export type GenerationTelemetryInput = {
  requestId: string;
  logicalMode: ChatModel;
  provider: ProviderId | null;
  /** Logical model route label only — never the raw secret-bearing route payload. */
  model: string;
  usageKind: UsageKind;
  usage?: GenerationCostEstimate | null;
  providerTtftMs: number | null;
  generationDurationMs: number;
  totalDurationMs?: number;
  finishReason?: string;
  failureCategory?: FailureCategory;
  deepResearch?: boolean;
  actionId?: string;
  streamCompleted?: boolean;
  outputChars?: number;
  usageReservationMs?: number;
  spendReservedMicros?: number;
  spendAccepted?: boolean;
};

/**
 * Per-generation cost/latency telemetry. Never includes prompts, message bodies, or secrets.
 * Field names stay camelCase so the logger's sensitive-key filter does not strip `*token*` auth keys.
 */
export function logGenerationTelemetry(input: GenerationTelemetryInput) {
  const usage = input.usage;
  logInfo("chat.response.metrics", {
    requestId: input.requestId,
    logicalMode: input.logicalMode,
    provider: input.provider,
    model: input.model,
    usageKind: input.usageKind,
    inputTokenCount: usage?.inputTokens,
    outputTokenCount: usage?.outputTokens,
    reasoningTokenCount: usage?.reasoningTokens,
    totalTokenCount: usage?.totalTokens,
    usageSource: usage?.source,
    estimatedUsdMicros: usage?.estimatedUsdMicros,
    estimatedUsd: usage ? Number(usage.estimatedUsd.toFixed(6)) : undefined,
    providerTtftMs: input.providerTtftMs,
    generationDurationMs: input.generationDurationMs,
    totalDurationMs: input.totalDurationMs,
    finishReason: input.finishReason,
    failureCategory: input.failureCategory ?? "none",
    deepResearch: input.deepResearch === true,
    actionId: input.actionId,
    streamCompleted: input.streamCompleted,
    outputChars: input.outputChars,
    usageReservationMs: input.usageReservationMs,
    spendReservedMicros: input.spendReservedMicros,
    spendAccepted: input.spendAccepted,
  });
}

export function failureCategoryFrom(input: {
  finishReason?: string;
  interrupted?: boolean;
  spendRejected?: boolean;
  quotaRejected?: boolean;
  stage?: string;
}): FailureCategory {
  if (input.quotaRejected) return "quota";
  if (input.spendRejected) return "spend";
  if (input.interrupted) return "abort";
  if (input.finishReason === "timeout") return "timeout";
  if (input.stage === "persist") return "persist";
  if (input.stage === "context") return "context";
  if (input.stage === "research") return "research";
  if (input.stage === "stream") return "stream";
  if (input.stage === "provider") return "provider";
  if (input.finishReason && input.finishReason !== "stop" && input.finishReason !== "unspecified") return "provider";
  return "none";
}
