import "server-only";

import { createReasoningStreamFilter } from "@/lib/ai/sanitize-model-output";
import { ProviderStreamError, readOpenAiSse } from "@/lib/ai/sse";
import { createCitationStreamFilter } from "@/lib/citations/parse";
import type { SourceReference } from "@/lib/citations/types";
import { stoppedPlaceholder } from "@/lib/chat/stop";
import type { createGenerationLifecycle } from "@/lib/chat/orchestration/generation-lifecycle";
import type { createGenerationPersistence, GenerationPersistResult, GenerationTerminalStatus } from "@/lib/chat/orchestration/persist-result";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import type { ProviderTokenUsage } from "@/lib/usage/provider-usage";
import { failureCategoryFrom } from "@/lib/usage/telemetry";

export function chatSseEvent(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Run one prepared provider stream. HTTP/auth, tool execution, usage gates, and final cleanup stay with callers. */
export function createGenerationStream(input: {
  responseStream: ReadableStream<Uint8Array>;
  lifecycle: ReturnType<typeof createGenerationLifecycle>;
  persistence: ReturnType<typeof createGenerationPersistence>;
  sources: readonly SourceReference[];
  requestId: string;
  assistantId: string;
  providerStartedAt: number;
  durationMs: () => number;
  emit: (type: string, data: unknown) => void;
  interrupted: () => boolean;
  onStart?: () => void;
  onComplete: () => void;
  /** Preserve existing path-specific timeout classification and operational logging during extraction. */
  path: "ordinary" | "action";
}) {
  const { responseStream, lifecycle, requestId, assistantId, durationMs, emit } = input;
  const { persist, persistCitationSourcesForKeptReply } = input.persistence;
  const safeError = "Nibie couldn't complete that response. Please try again.";
  const timeoutError = "The provider took too long to finish this response. Please try again.";
  const ordinary = input.path === "ordinary";
  const reasoningFilter = createReasoningStreamFilter();
  const citationFilter = createCitationStreamFilter(input.sources);
  let output = "";
  let completed = false;
  let sealed = false;
  let finishReason = "unspecified";
  let providerUsage: ProviderTokenUsage | null = null;
  let providerTtftMs: number | null = null;
  let failureCategory = failureCategoryFrom({});
  let interruptedSave: Promise<GenerationPersistResult> | undefined;
  let running: Promise<void> | undefined;

  const publish = (text: string) => {
    if (!text) return;
    providerTtftMs ??= Date.now() - input.providerStartedAt;
    output += text;
    if (!lifecycle.clientCancelled) emit("delta", { text });
  };
  const seal = () => {
    if (sealed) return;
    sealed = true;
    const afterReasoning = reasoningFilter.finish();
    if (afterReasoning) publish(citationFilter.push(afterReasoning));
    publish(citationFilter.finish());
    logInfo("citation.references.parsed", { requestId, sourceCount: input.sources.length, citationCount: citationFilter.citationCount });
    if (citationFilter.invalidCitationCount > 0) {
      logInfo("citation.references.invalid", { requestId, sourceCount: input.sources.length, invalidCitationCount: citationFilter.invalidCitationCount });
    }
    if (ordinary && reasoningFilter.reasoningBlockCount > 0) {
      console.info(JSON.stringify({ event: "ai.reasoning.filtered", requestId: assistantId, reasoningBlockCount: reasoningFilter.reasoningBlockCount }));
    }
  };
  const save = async (status: GenerationTerminalStatus): Promise<GenerationPersistResult> => {
    seal();
    if (lifecycle.userStopped) {
      await persistCitationSourcesForKeptReply(output);
      return "stopped";
    }
    const content = output || (status === "interrupted" ? stoppedPlaceholder : "Response unavailable.");
    if (status === "interrupted") return interruptedSave ??= persist(content, status);
    return persist(content, status);
  };
  const reportStopped = () => {
    failureCategory = failureCategoryFrom({ interrupted: true });
    if (ordinary) logWarn("chat.response.interrupted", { requestId, status: "interrupted", reason: "user_stopped", durationMs: durationMs() });
    if (!lifecycle.clientCancelled) emit("status", { status: "interrupted" });
  };
  const consume = async () => {
    try {
      if (ordinary && lifecycle.clientCancelled) throw new Error("Response aborted.");
      input.onStart?.();
      for await (const item of readOpenAiSse(responseStream, lifecycle.signal)) {
        if (item.type === "done") {
          completed = true;
          finishReason = item.finishReason ?? "unspecified";
          if (item.usage) providerUsage = item.usage;
          break;
        }
        if (item.text) publish(citationFilter.push(reasoningFilter.push(item.text)));
      }
      seal();
      if (input.interrupted()) {
        const saved = await save("interrupted");
        failureCategory = failureCategoryFrom({ interrupted: true });
        logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
        if (!lifecycle.clientCancelled) emit(saved !== "failed" ? "status" : "error", saved !== "failed" ? { status: "interrupted" } : { error: safeError });
      } else if (completed && output.length > 0) {
        const saved = await save("complete");
        if (saved === "saved") {
          logInfo("chat.response.completed", { requestId, status: "complete", durationMs: durationMs() });
          try { input.onComplete(); } catch { /* best effort summary maintenance */ }
          emit("status", { status: "complete" });
        } else if (saved === "stopped") {
          reportStopped();
        } else {
          await save("error");
          failureCategory = failureCategoryFrom({ stage: "persist" });
          if (ordinary) logError("chat.response.failed", { requestId, stage: "persist", code: operationalCodes.assistantPersistFailed, status: "error", durationMs: durationMs() });
          emit("error", { error: safeError });
        }
      } else if (await save("error") === "stopped") {
        reportStopped();
      } else {
        failureCategory = failureCategoryFrom({ stage: "stream", finishReason });
        if (ordinary) logError("chat.response.failed", { requestId, stage: "stream", code: operationalCodes.aiProviderFailed, status: "error", durationMs: durationMs() });
        emit("error", { error: safeError });
      }
    } catch (error) {
      if (error instanceof ProviderStreamError) finishReason = error.finishReason;
      else if (lifecycle.providerTimedOut) finishReason = "timeout";
      let saved: GenerationPersistResult = "failed";
      try { saved = await save(input.interrupted() ? "interrupted" : "error"); }
      catch { logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist" }); }
      const interrupted = saved === "stopped" || input.interrupted();
      failureCategory = failureCategoryFrom({ interrupted, finishReason, stage: interrupted ? undefined : "stream" });
      if (ordinary) {
        if (interrupted) logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
        else logError("chat.response.failed", { requestId, stage: "stream", code: operationalCodes.aiProviderFailed, status: "error", durationMs: durationMs() });
      }
      if (!interrupted) emit("error", { error: error instanceof ProviderStreamError ? error.message : lifecycle.providerTimedOut ? timeoutError : safeError });
      else if (!lifecycle.clientCancelled) emit(saved !== "failed" ? "status" : "error", saved !== "failed" ? { status: "interrupted" } : { error: safeError });
    }
  };
  return {
    run: () => running ??= consume(),
    get output() { return output; },
    get completed() { return completed; },
    get finishReason() { return finishReason; },
    get providerUsage() { return providerUsage; },
    get providerTtftMs() { return providerTtftMs; },
    get failureCategory() { return failureCategory; },
  };
}
