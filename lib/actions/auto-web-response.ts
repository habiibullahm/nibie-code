import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatProvider, configuredModelLabel } from "@/lib/ai/provider";
import { toProviderMessages } from "@/lib/ai/provider-messages";
import { contextCapabilitiesFor, providerFor } from "@/lib/ai/registry";
import type { ChatModel } from "@/lib/chat/validation";
import { stoppedPlaceholder } from "@/lib/chat/stop";
import { createGenerationPersistence } from "@/lib/chat/orchestration/persist-result";
import { createGenerationLifecycle } from "@/lib/chat/orchestration/generation-lifecycle";
import { chatSseEvent as event, createGenerationStream } from "@/lib/chat/orchestration/stream-response";
import { attachWebCitationHandles } from "@/lib/citations/attach";
import { citationSourcesIncludedInContext } from "@/lib/citations/included";
import { citationViewsFromPrepared } from "@/lib/citations/persist";
import { citationInstructionFor } from "@/lib/citations/prepare";
import type { SourceReference } from "@/lib/citations/types";
import { buildContext } from "@/lib/context/build-context";
import { CONTEXT_POLICY_VERSION } from "@/lib/context/context-policy";
import type { AttachmentContextInput, FileContextInput, ThreadSummary } from "@/lib/context/context-types";
import type { RoomContextInput } from "@/lib/context/room-context";
import { deferThreadSummaryMaintenance } from "@/lib/context/thread-summary-store";
import {
  ACTION_FAILED_TRUTHFULNESS_INSTRUCTION,
  actionSucceeded,
  executeAction,
  formatActionResultForModel,
  getAction,
  MAX_ACTIONS_PER_GENERATION,
  WEB_SEARCH_ACTION_ID,
  webSourcesFromActionResult,
} from "@/lib/actions/index";
import type { ActionRuntimeOutcome } from "@/lib/actions/types";
import { CONTEXT_DATA_PREAMBLE } from "@/lib/context/context-policy";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import type { UserPreferences } from "@/lib/preferences/types";
import type { MemoryRecord, RecallOperationStatus } from "@/lib/recall/types";
import { reserveUsageBeforeGeneration } from "@/lib/usage/guards";
import { estimateUsageFromText, withCostEstimate } from "@/lib/usage/provider-usage";
import { failureCategoryFrom, logGenerationTelemetry } from "@/lib/usage/telemetry";
import type { WebContextInput } from "@/lib/web/types";

const encoder = new TextEncoder();
const safeError = "Nibie couldn't complete that response. Please try again.";


type AutoActionChatBase = {
  request: Request;
  requestId: string;
  requestStartedAt: number;
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  roomId: string | null;
  assistant: { id: string; position: number };
  userMessage: { id: string; content: string; position: number };
  mode: ChatModel;
  preferences: UserPreferences;
  preferenceReadFailed: boolean;
  summary: ThreadSummary | null;
  room: RoomContextInput | null;
  files: FileContextInput[] | undefined;
  attachments: AttachmentContextInput[];
  memories: MemoryRecord[] | undefined;
  recallOperation: RecallOperationStatus;
  rows: { role: string; content: string; position: number }[];
  omittedMessagePositions?: number[];
  /** HTTP preflight already reserved this generation; do not reserve again. */
  weeklyUsageReserved?: boolean;
};

export type AutoWebActionChatInput = AutoActionChatBase & {
  webRouteReason: string;
};

export type AutoGitHubActionChatInput = AutoActionChatBase & {
  githubActionId: string;
  githubRawInput: unknown;
  githubRouteReason: string;
  githubActionTitle?: string;
};

type ResolvedActionChat = AutoActionChatBase & {
  actionId: string;
  actionTitle: string;
  rawInput: unknown;
  routeReason: string;
  fold: "web" | "github";
};

/**
 * Automatic Web Search via Action Runtime: early SSE (action_start → execute → action_result),
 * then context + provider synthesis. One Action per generation. Stop cancels the Action.
 * Shares the Cost Guard reserve → start → finalize path with GitHub Read.
 */
export async function createAutoWebActionChatResponse(input: AutoWebActionChatInput): Promise<Response> {
  return createAutoActionChatResponse({
    ...input,
    actionId: WEB_SEARCH_ACTION_ID,
    actionTitle: "Web Search",
    rawInput: { query: input.userMessage.content },
    routeReason: input.webRouteReason,
    fold: "web",
  });
}

/**
 * GitHub Read via the same Action Runtime + Cost Guard path as web.search.
 * One allowlisted github.* Action per generation. Public repos only (enforced in tools).
 */
export async function createAutoGitHubActionChatResponse(input: AutoGitHubActionChatInput): Promise<Response> {
  const registered = getAction(input.githubActionId);
  return createAutoActionChatResponse({
    ...input,
    actionId: input.githubActionId,
    actionTitle: input.githubActionTitle ?? registered?.title ?? "GitHub",
    rawInput: input.githubRawInput,
    routeReason: input.githubRouteReason,
    fold: "github",
  });
}

async function createAutoActionChatResponse(input: ResolvedActionChat): Promise<Response> {
  const {
    request,
    requestId,
    requestStartedAt,
    supabase,
    userId,
    conversationId,
    roomId,
    assistant,
    userMessage,
    mode,
    preferences,
    preferenceReadFailed,
    summary,
    room,
    files,
    attachments,
    memories,
    recallOperation,
    rows,
    weeklyUsageReserved = false,
    actionId,
    actionTitle,
    rawInput,
    routeReason,
    fold,
  } = input;

  const headers = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" };
  const responseStartedAt = Date.now();
  const durationMs = () => Date.now() - responseStartedAt;

  const lifecycle = createGenerationLifecycle({
    requestSignal: request.signal,
    supabase,
    userId,
    generationId: assistant.id,
    requestId,
    mode,
    stopStage: "action",
    durationMs,
  });
  lifecycle.watchForStop();

  let citationSources: SourceReference[] = [];
  let citationViews: ReturnType<typeof citationViewsFromPrepared> = [];
  const persistence = createGenerationPersistence({
    supabase,
    userId,
    conversationId,
    assistantId: assistant.id,
    requestId,
    citationSources: () => citationSources,
  });

  const { persist } = persistence;
  const releaseReservation = lifecycle.releaseBeforeStart;

  const summaryMaintenance = deferThreadSummaryMaintenance({ supabase, conversationId, requestId });
  let usageReservationMs = 0;
  let spendReservedMicros = 0;
  let providerStartedAt = Date.now();
  const timeoutError = "The provider took too long to finish this response. Please try again.";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (type: string, data: unknown) => {
        if (!lifecycle.clientCancelled) controller.enqueue(encoder.encode(event(type, data)));
      };

      // Early start so the client can show Action status while the Action runs.
      enqueue("start", { id: assistant.id, position: assistant.position });
      enqueue("action_start", {
        actionId,
        runId: null,
        title: actionTitle,
      });

      try {
        if (lifecycle.clientCancelled || lifecycle.signal.aborted) {
          await releaseReservation();
          await persist("Response stopped.", "interrupted");
          enqueue("status", { status: "interrupted" });
          return;
        }

        const generationActionCount = { current: 0 };
        if (fold === "web") {
          logInfo("web.route.decided", { requestId, search: true, reason: routeReason });
        } else {
          logInfo("github.route.decided", { requestId, use: true, reason: routeReason, actionId });
        }
        logInfo("action.started", { requestId, actionId });
        const actionStartedAt = Date.now();
        const outcome: ActionRuntimeOutcome = await executeAction({
          actionId,
          rawInput,
          ctx: {
            userId,
            conversationId,
            roomId,
            messageId: assistant.id,
            requestId,
            signal: lifecycle.signal,
          },
          supabase,
          generationActionCount,
          timeoutMs: 45_000,
        });

        if (generationActionCount.current > MAX_ACTIONS_PER_GENERATION) {
          /* defensive — executeAction already enforces */
        }

        const actionDurationMs = Date.now() - actionStartedAt;
        if (outcome.status === "cancelled" || lifecycle.signal.aborted || lifecycle.userStopped || lifecycle.clientCancelled) {
          logInfo("action.cancelled", { requestId, actionId, durationMs: actionDurationMs });
          enqueue("action_error", {
            actionId,
            runId: outcome.runId,
            status: "cancelled",
            errorCode: "aborted",
          });
          await releaseReservation();
          await persist(stoppedPlaceholder, "interrupted");
          enqueue("status", { status: "interrupted" });
          return;
        }

        if (outcome.status === "completed" && outcome.result.ok) {
          logInfo("action.completed", {
            requestId,
            actionId,
            itemCount: outcome.result.items.length,
            durationMs: actionDurationMs,
          });
          enqueue("action_result", {
            actionId,
            runId: outcome.runId,
            status: "completed",
            summary: outcome.result.summary,
          });
        } else {
          logWarn("action.failed", {
            requestId,
            actionId,
            errorCode: outcome.result.errorCode ?? "execution_failed",
            durationMs: actionDurationMs,
            code: fold === "web" ? operationalCodes.webSearchFailed : operationalCodes.requestFailed,
          });
          enqueue("action_error", {
            actionId,
            runId: outcome.runId,
            status: outcome.status === "failed" ? "failed" : outcome.status,
            errorCode: outcome.result.errorCode ?? "execution_failed",
          });
        }

        let web: WebContextInput[] | undefined;
        let preparedCitationSources: SourceReference[] = [];
        let webVerificationUnavailable = false;
        let githubActionText: string | null = null;
        if (fold === "web") {
          const sources = webSourcesFromActionResult(outcome.result);
          if (sources.length && actionSucceeded(outcome)) {
            const attached = attachWebCitationHandles(sources);
            web = attached.web.length ? attached.web : undefined;
            preparedCitationSources = attached.sources;
            if (!web?.length) webVerificationUnavailable = true;
            logInfo("web.search.succeeded", {
              requestId,
              resultCount: outcome.result.metadata && typeof outcome.result.metadata === "object" && "searchResultCount" in outcome.result.metadata
                ? Number((outcome.result.metadata as { searchResultCount?: number }).searchResultCount ?? sources.length)
                : sources.length,
              durationMs: actionDurationMs,
            });
            logInfo("web.context.included", { requestId, sourceCount: web?.length ?? 0, snippetOnlyCount: (web ?? []).filter((s) => s.retrieval === "web_snippet_only").length });
          } else {
            webVerificationUnavailable = true;
            logWarn("web.search.failed", {
              requestId,
              category: outcome.result.errorMessage ?? outcome.result.errorCode ?? "empty",
              durationMs: actionDurationMs,
              code: operationalCodes.webSearchFailed,
            });
          }
        } else {
          githubActionText = formatActionResultForModel(outcome);
          if (actionSucceeded(outcome)) {
            logInfo("github.action.succeeded", {
              requestId,
              actionId,
              itemCount: outcome.result.items.length,
              durationMs: actionDurationMs,
            });
          } else {
            logWarn("github.action.failed", {
              requestId,
              actionId,
              category: outcome.result.errorMessage ?? outcome.result.errorCode ?? "empty",
              durationMs: actionDurationMs,
              code: operationalCodes.requestFailed,
            });
          }
        }

        let prompt: ReturnType<typeof toProviderMessages> | undefined;
        let context: ReturnType<typeof buildContext>["diagnostics"] | undefined;
        try {
          const started = Date.now();
          // Truthfulness stays in authoritative policy; Action/web bodies stay in untrusted fences.
          const extraPolicy = !actionSucceeded(outcome) ? ACTION_FAILED_TRUTHFULNESS_INSTRUCTION : null;
          const plan = buildContext({
            responseMode: mode,
            capabilities: contextCapabilitiesFor(mode),
            preferences,
            preferenceReadFailed,
            summary,
            room,
            files,
            attachments,
            web,
            webVerificationUnavailable,
            memories,
            recallOperation,
            extraPolicyInstruction: extraPolicy,
            messages: rows.map((row) => ({
              role: row.role as "user" | "assistant",
              content: row.content,
              position: row.position,
            })),
            currentPosition: userMessage.position,
            omittedMessagePositions: input.omittedMessagePositions,
          });
          prompt = toProviderMessages(plan);
          context = plan.diagnostics;
          citationSources = citationSourcesIncludedInContext(preparedCitationSources, plan.includedCitationHandles);
          citationViews = citationViewsFromPrepared(citationSources);
          if (citationSources.length && prompt[0]?.role === "system") {
            const citationRules = citationInstructionFor(citationSources);
            if (citationRules) {
              prompt = [{ role: "system", content: `${prompt[0].content}\n\n${citationRules}` }, ...prompt.slice(1)];
            }
          }
          if (githubActionText) {
            const dataIdx = prompt.findIndex((message, index) => index > 0 && message.role === "system");
            if (dataIdx >= 0) {
              const existing = prompt[dataIdx]!;
              prompt = [
                ...prompt.slice(0, dataIdx),
                { role: "system", content: `${existing.content}\n\n${githubActionText}` },
                ...prompt.slice(dataIdx + 1),
              ];
            } else if (prompt[0]?.role === "system") {
              prompt = [
                prompt[0],
                { role: "system", content: `${CONTEXT_DATA_PREAMBLE}\n\n${githubActionText}` },
                ...prompt.slice(1),
              ];
            }
          }
          // Early start omitted diagnostics; send them now so the context panel matches ordinary chat.
          enqueue("context", { context });
          logInfo("context.built", {
            requestId,
            durationMs: Date.now() - started,
            webIncluded: plan.blocks.some((b) => b.id === "web" && b.included),
            webCount: web?.length ?? 0,
            githubActionIncluded: Boolean(githubActionText),
            sourceCount: plan.blocks.filter((b) => b.included).length,
            recentMessageCount: plan.diagnostics.recentMessageCount,
            estimatedTokens: plan.budget.estimatedTokens,
            truncated: plan.budget.truncated,
            ...plan.continuity,
            policyVersion: CONTEXT_POLICY_VERSION,
          });
        } catch {
          logError("context.build.failed", { requestId, code: operationalCodes.contextBuildFailed, stage: "context", durationMs: durationMs() });
          await releaseReservation();
          await persist("Response unavailable.", "error");
          enqueue("error", { error: safeError });
          return;
        }

        if (!prompt || !context) {
          await releaseReservation();
          await persist("Response unavailable.", "error");
          enqueue("error", { error: safeError });
          return;
        }

        if (lifecycle.clientCancelled || lifecycle.signal.aborted || lifecycle.userStopped) {
          await releaseReservation();
          await persist(stoppedPlaceholder, "interrupted");
          enqueue("status", { status: "interrupted" });
          return;
        }

        // Preflight may already hold this generation's reservation; never release-then-re-reserve.
        if (!weeklyUsageReserved) {
          const gate = await reserveUsageBeforeGeneration({
            supabase,
            userId,
            generationId: assistant.id,
            mode,
            usageKind: "chat",
            requestId,
          });
          if (!gate.ok) {
            await persist(
              gate.code === operationalCodes.weeklyUsageLimitRejected
                ? "Weekly usage limit reached."
                : gate.code === operationalCodes.aiSpendLimitRejected
                  ? "AI spend budget reached."
                  : lifecycle.clientCancelled ? "Response stopped." : "Response unavailable.",
              gate.status === 429 || !lifecycle.clientCancelled ? "error" : "interrupted",
            );
            enqueue("error", { error: gate.error });
            return;
          }
          usageReservationMs = gate.usageReservationMs;
          spendReservedMicros = gate.spendReservedMicros;
        }

        if (lifecycle.clientCancelled || lifecycle.signal.aborted || lifecycle.userStopped) {
          await releaseReservation();
          await persist(stoppedPlaceholder, "interrupted");
          enqueue("status", { status: "interrupted" });
          return;
        }

        lifecycle.startProviderTimeout();
        providerStartedAt = Date.now();
        let responseStream: ReadableStream<Uint8Array>;
        try {
          responseStream = await chatProvider.stream(mode, prompt, lifecycle.signal);
        } catch {
          lifecycle.clearProviderTimeout();
          const interrupted = lifecycle.userStopped || lifecycle.clientCancelled || lifecycle.signal.aborted;
          if (interrupted) logWarn("chat.response.interrupted", { requestId, stage: "provider", status: "interrupted", durationMs: durationMs() });
          else logError("chat.response.failed", { requestId, durationMs: durationMs(), stage: "provider", code: operationalCodes.aiProviderFailed });
          if (!interrupted) await releaseReservation();
          if (!lifecycle.userStopped) {
            await persist(lifecycle.clientCancelled ? stoppedPlaceholder : "Response unavailable.", lifecycle.clientCancelled ? "interrupted" : "error");
          }
          if (interrupted) enqueue("status", { status: "interrupted" });
          else enqueue("error", { error: lifecycle.providerTimedOut ? timeoutError : safeError });
          return;
        }

        const usageStarted = await lifecycle.startUsage();
        if (!usageStarted) {
          lifecycle.clearProviderTimeout();
          lifecycle.abortProvider();
          await releaseReservation();
          await persist(lifecycle.clientCancelled ? "Response stopped." : "Response unavailable.", lifecycle.clientCancelled ? "interrupted" : "error");
          enqueue("error", { error: safeError });
          return;
        }

        // Re-announce start metadata now that context/sources exist (client already has the row).
        if (citationViews.length) enqueue("sources", { sources: citationViews });

        const generation = createGenerationStream({
          responseStream, lifecycle, persistence, sources: citationSources,
          requestId, assistantId: assistant.id, providerStartedAt, durationMs,
          path: "action",
          interrupted: () => lifecycle.userStopped || lifecycle.clientCancelled || lifecycle.signal.aborted,
          emit: enqueue,
          onComplete: () => summaryMaintenance.complete(assistant.position),
        });
        try {
          await generation.run();
        } finally {
          lifecycle.clearProviderTimeout();
          const costEstimate = withCostEstimate(
            mode,
            generation.providerUsage ?? estimateUsageFromText({
              promptChars: prompt.reduce((sum, message) => sum + message.content.length, 0),
              outputChars: generation.output.length,
            }),
          );
          await lifecycle.settleSpend(costEstimate.estimatedUsdMicros);
          logGenerationTelemetry({
            requestId,
            logicalMode: mode,
            provider: providerFor(mode),
            model: configuredModelLabel(mode),
            usageKind: "chat",
            usage: costEstimate,
            providerTtftMs: generation.providerTtftMs,
            generationDurationMs: Date.now() - providerStartedAt,
            totalDurationMs: Date.now() - requestStartedAt,
            finishReason: generation.finishReason,
            failureCategory: failureCategoryFrom({ finishReason: generation.finishReason }),
            streamCompleted: generation.completed,
            outputChars: generation.output.length,
            usageReservationMs,
            spendReservedMicros,
            spendAccepted: true,
            actionId,
          });
        }
      } catch {
        logError("chat.response.failed", { requestId, code: operationalCodes.requestFailed, stage: "action", durationMs: durationMs() });
        try {
          await releaseReservation();
        } catch {
          /* ignore */
        }
        try {
          await persist("Response unavailable.", "error");
        } catch {
          /* ignore */
        }
        enqueue("error", { error: safeError });
      } finally {
        lifecycle.cleanup();
        try {
          summaryMaintenance.finish();
        } catch {
          /* best effort */
        }
        if (!lifecycle.clientCancelled) {
          controller.enqueue(encoder.encode(event("done", {})));
          controller.close();
        }
      }
    },
    cancel() {
      lifecycle.cancel();
    },
  });

  return new Response(stream, { headers });
}
