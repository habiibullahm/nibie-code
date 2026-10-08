import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatProvider, configuredModelLabel } from "@/lib/ai/provider";
import { toProviderMessages } from "@/lib/ai/provider-messages";
import { contextCapabilitiesFor, providerFor } from "@/lib/ai/registry";
import { createReasoningStreamFilter } from "@/lib/ai/sanitize-model-output";
import { ProviderStreamError, readOpenAiSse } from "@/lib/ai/sse";
import type { ChatModel } from "@/lib/chat/validation";
import { stopPollMs, stoppedPlaceholder } from "@/lib/chat/stop";
import { attachWebCitationHandles } from "@/lib/citations/attach";
import { MAX_RESEARCH_PREPARED_SOURCES } from "@/lib/citations/prepare";
import { citationSourcesIncludedInContext } from "@/lib/citations/included";
import { createCitationStreamFilter } from "@/lib/citations/parse";
import { citationViewsFromPrepared, persistMessageSources } from "@/lib/citations/persist";
import type { SourceReference } from "@/lib/citations/types";
import { buildContext } from "@/lib/context/build-context";
import { CONTEXT_POLICY_VERSION } from "@/lib/context/context-policy";
import type { ConversationInstructionsInput } from "@/lib/chat-instructions/context";
import type { AttachmentContextInput, FileContextInput, ThreadSummary } from "@/lib/context/context-types";
import type { RoomContextInput } from "@/lib/context/room-context";
import { RESEARCH_WEB_TOKEN_CAP } from "@/lib/context/token-budget";
import { deferThreadSummaryMaintenance } from "@/lib/context/thread-summary-store";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import type { UserPreferences } from "@/lib/preferences/types";
import { RESEARCH_ROUTE_BUDGET_MS, RESEARCH_SYNTHESIS_TIMEOUT_MS } from "@/lib/research/budgets";
import { runDeepResearch } from "@/lib/research/orchestrator";
import { persistMessageResearch } from "@/lib/research/persist";
import { researchSynthesisInstruction } from "@/lib/research/synthesize";
import type { ResearchProgressStage, ResearchRunMetrics, ResearchRunStatus } from "@/lib/research/types";
import { researchUsagePolicyFields } from "@/lib/research/usage-policy";
import type { MemoryRecord, RecallOperationStatus } from "@/lib/recall/types";
import {
  finalizeGenerationSpend,
  releaseUsageHold,
  releaseWeeklyUsageHold,
  reserveUsageBeforeGeneration,
  startWeeklyUsage,
} from "@/lib/usage/guards";
import { estimateUsageFromText, withCostEstimate, type ProviderTokenUsage } from "@/lib/usage/provider-usage";
import { estimateResearchSpendMicros } from "@/lib/usage/research-spend";
import { failureCategoryFrom, logGenerationTelemetry } from "@/lib/usage/telemetry";
import { getWebSearchProvider } from "@/lib/web/provider";

const encoder = new TextEncoder();
const safeError = "Nibie couldn't complete that response. Please try again.";

function event(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type DeepResearchChatStreamInput = {
  request: Request;
  requestId: string;
  requestStartedAt: number;
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  assistant: { id: string; position: number };
  userMessage: { id: string; content: string; position: number };
  mode: ChatModel;
  availablePlanMode: ChatModel;
  preferences: UserPreferences;
  preferenceReadFailed: boolean;
  summary: ThreadSummary | null;
  conversationInstructions?: ConversationInstructionsInput | null;
  room: RoomContextInput | null;
  files: FileContextInput[] | undefined;
  attachments: AttachmentContextInput[];
  memories: MemoryRecord[] | undefined;
  recallOperation: RecallOperationStatus;
  rows: { role: string; content: string; position: number }[];
  /** HTTP preflight already reserved this generation; do not reserve again. */
  weeklyUsageReserved?: boolean;
};

/**
 * Deep Research generation path: early SSE start + progress stages, bounded orchestrator,
 * Citations V1 attach/stream/persist, Stop-aware, metered via research_metered_v1.
 */
export async function createDeepResearchChatResponse(input: DeepResearchChatStreamInput): Promise<Response> {
  const {
    request,
    requestId,
    requestStartedAt,
    supabase,
    userId,
    conversationId,
    assistant,
    userMessage,
    mode,
    availablePlanMode,
    preferences,
    preferenceReadFailed,
    summary,
    conversationInstructions = null,
    room,
    files,
    attachments,
    memories,
    recallOperation,
    rows,
    weeklyUsageReserved = false,
  } = input;

  const headers = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" };
  const responseStartedAt = Date.now();
  const durationMs = () => Date.now() - responseStartedAt;

  logInfo("chat.response.started", { requestId, regenerate: false, mode, deepResearch: true });
  logInfo("research.started", { requestId, ...researchUsagePolicyFields() });

  let citationSources: SourceReference[] = [];
  let citationViews: ReturnType<typeof citationViewsFromPrepared> = [];
  let researchStatus: ResearchRunStatus = "failed";
  let researchMetrics: ResearchRunMetrics = {
    modelCallCount: 0,
    searchQueryCount: 0,
    searchResultCount: 0,
    pagesFetched: 0,
    pagesFailed: 0,
    candidateUrlCount: 0,
    evidenceCount: 0,
    followUpUsed: false,
    durationMs: 0,
    timeSensitive: false,
  };

  const persistResearch = async (status: ResearchRunStatus) => {
    researchStatus = status;
    await persistMessageResearch({
      supabase,
      userId,
      conversationId,
      messageId: assistant.id,
      status,
      metrics: researchMetrics,
      followUpUsed: researchMetrics.followUpUsed,
    });
  };

  const persist = async (content: string, status: "complete" | "interrupted" | "error"): Promise<"saved" | "stopped" | "failed"> => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .update({ content, status })
        .eq("id", assistant.id)
        .eq("status", "streaming")
        .select("id")
        .maybeSingle();
      if (!error && data) {
        if ((status === "complete" || status === "interrupted") && citationSources.length) {
          const savedSources = await persistMessageSources({
            supabase,
            userId,
            conversationId,
            messageId: assistant.id,
            sources: citationSources,
          });
          if (!savedSources.ok) {
            logWarn("citation.sources.persist_failed", { requestId, sourceCount: citationSources.length });
          }
        }
        await persistResearch(
          status === "interrupted" ? "interrupted" : status === "error" ? "failed" : researchStatus === "incomplete" ? "incomplete" : "complete",
        );
        return "saved";
      }
      const { data: row } = await supabase.from("messages").select("status").eq("id", assistant.id).maybeSingle();
      if (!error && row?.status === "interrupted") return "stopped";
    } catch {
      /* reported below */
    }
    logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status });
    return "failed";
  };

  const aborter = new AbortController();
  let clientCancelled = false;
  let userStopped = false;
  const onRequestAbort = () => {
    clientCancelled = true;
    aborter.abort();
  };
  request.signal.addEventListener("abort", onRequestAbort, { once: true });
  if (request.signal.aborted) onRequestAbort();

  let userStoppedFlag = false;
  let stopCheck: Promise<void> | null = null;
  const checkStopped = async () => {
    try {
      const { data, error } = await supabase.from("messages").select("status").eq("id", assistant.id).maybeSingle();
      if (error || data?.status === "streaming" || userStoppedFlag || aborter.signal.aborted) return;
      userStoppedFlag = true;
      userStopped = true;
      clearInterval(stopWatch);
      logInfo("chat.response.user_stopped", {
        requestId,
        reason: "user_stopped",
        stage: "research",
        status: data?.status ?? "missing",
        durationMs: durationMs(),
      });
      aborter.abort();
    } catch {
      /* retry next tick */
    } finally {
      stopCheck = null;
    }
  };
  const stopWatch = setInterval(() => {
    stopCheck ??= checkStopped();
  }, stopPollMs);

  let spendSettled = false;
  let researchWorkStarted = false;
  let synthesisStarted = false;
  /** Full credit+spend release — only before research work incurs cost. */
  const releaseReservation = async () => {
    await releaseUsageHold({ supabase, userId, generationId: assistant.id, requestId, logicalMode: mode });
    spendSettled = true;
  };
  /** After planner/search work, refund unstarted weekly credits but leave spend for finalize. */
  const releaseCreditsOnly = async () => {
    await releaseWeeklyUsageHold({ supabase, generationId: assistant.id, requestId, logicalMode: mode });
  };

  const summaryMaintenance = deferThreadSummaryMaintenance({ supabase, conversationId, requestId });
  let usageReservationMs = 0;
  let spendReservedMicros = 0;
  let providerStartedAt = Date.now();
  let providerTtftMs: number | null = null;
  let finishReason = "unspecified";
  let providerUsage: ProviderTokenUsage | null = null;
  let synthesisPromptChars = 8_000;
  let synthesisOutputChars = 0;
  const providerTimedOutRef = { value: false };
  const timeoutError = "The provider took too long to finish this response. Please try again.";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (type: string, data: unknown) => {
        if (!clientCancelled) controller.enqueue(encoder.encode(event(type, data)));
      };

      enqueue("start", { id: assistant.id, position: assistant.position, research: true });

      try {
        if (clientCancelled || aborter.signal.aborted) {
          await releaseReservation();
          await persist("Response stopped.", "interrupted");
          logInfo("research.interrupted", { requestId, stage: "start", durationMs: durationMs() });
          enqueue("status", { status: "interrupted" });
          return;
        }

        let research = await runDeepResearch({
          question: userMessage.content,
          signal: aborter.signal,
          chatProvider,
          planMode: availablePlanMode,
          searchProvider: getWebSearchProvider(),
          onProgress: (stage: ResearchProgressStage) => {
            enqueue("progress", { stage });
            if (stage === "planning") {
              /* plan.completed logged after orchestrator */
            }
          },
        });
        researchWorkStarted = true;

        researchMetrics = research.metrics;
        // Synthesis model call counted separately below.
        logInfo("research.plan.completed", {
          requestId,
          subquestionCount: research.plan?.subquestions.length ?? 0,
          queryCount: research.plan?.initialQueries.length ?? 0,
          timeSensitive: research.plan?.timeSensitive ?? false,
          durationMs: research.metrics.durationMs,
        });
        logInfo("research.search.completed", {
          requestId,
          searchQueryCount: research.metrics.searchQueryCount,
          searchResultCount: research.metrics.searchResultCount,
          candidateUrlCount: research.metrics.candidateUrlCount,
        });
        logInfo("research.fetch.completed", {
          requestId,
          pagesFetched: research.metrics.pagesFetched,
          pagesFailed: research.metrics.pagesFailed,
          evidenceCount: research.metrics.evidenceCount,
        });
        if (research.metrics.followUpUsed) {
          logInfo("research.followup.started", { requestId, followUpUsed: true });
        }

        // True user Stop / client cancel only. Gather-deadline "interrupted" (no user abort) must not
        // become a Stopped placeholder — with evidence it synthesizes as incomplete below.
        if (userStopped || clientCancelled || aborter.signal.aborted) {
          await releaseCreditsOnly();
          await persist(stoppedPlaceholder, "interrupted");
          logInfo("research.interrupted", { requestId, durationMs: durationMs(), ...researchUsagePolicyFields() });
          enqueue("status", { status: "interrupted" });
          return;
        }

        // Gather deadline (or other non-user interrupt) with evidence → treat as incomplete for synthesis.
        if (
          research.status === "interrupted" &&
          research.metrics.incompleteReason === "gather_deadline" &&
          research.evidence.length > 0 &&
          research.web.length > 0
        ) {
          research = { ...research, status: "incomplete" };
        }

        // Empty collection: hard-fail. Release any held preflight reservation; never synthesize.
        if (research.evidence.length === 0 || research.web.length === 0) {
          const message =
            research.incompleteNotice ??
            "Deep Research could not gather sources. Please try again later or switch to Normal.";
          citationSources = [];
          researchStatus = "failed";
          logWarn("research.failed", {
            requestId,
            category: research.metrics.incompleteReason ?? "empty",
            durationMs: durationMs(),
            code: operationalCodes.deepResearchFailed,
            ...researchUsagePolicyFields(),
          });
          await releaseCreditsOnly();
          await persist(message, "error");
          enqueue("error", { error: message });
          return;
        }

        const attached = attachWebCitationHandles(research.web, new Date(), MAX_RESEARCH_PREPARED_SOURCES);
        const web = attached.web.length ? attached.web : undefined;
        const preparedCitationSources = attached.sources;
        researchStatus = research.status;

        let prompt: ReturnType<typeof toProviderMessages> | undefined;
        let context: ReturnType<typeof buildContext>["diagnostics"] | undefined;
        try {
          const extraPolicy = research.plan
            ? researchSynthesisInstruction({
                plan: research.plan,
                sources: preparedCitationSources,
                contradictions: research.contradictions,
                incompleteNotice: research.incompleteNotice,
              })
            : null;
          const plan = buildContext({
            responseMode: mode,
            capabilities: contextCapabilitiesFor(mode),
            preferences,
            preferenceReadFailed,
            summary,
            conversationInstructions,
            room,
            files,
            attachments,
            web,
            webTokenCap: RESEARCH_WEB_TOKEN_CAP,
            webVerificationUnavailable: !web?.length,
            memories,
            recallOperation,
            extraPolicyInstruction: extraPolicy,
            messages: rows.map((row) => ({
              role: row.role as "user" | "assistant",
              content: row.content,
              position: row.position,
            })),
            currentPosition: userMessage.position,
          });
          prompt = toProviderMessages(plan);
          context = plan.diagnostics;
          citationSources = citationSourcesIncludedInContext(preparedCitationSources, plan.includedCitationHandles);
          citationViews = citationViewsFromPrepared(citationSources);
          if (citationViews.length) enqueue("sources", { sources: citationViews });
          if (preparedCitationSources.length || citationSources.length) {
            logInfo("citation.sources.prepared", { requestId, sourceCount: citationSources.length, deepResearch: true });
          }
          logInfo("context.built", {
            requestId,
            durationMs: 0,
            webIncluded: Boolean(web?.length),
            webCount: web?.length ?? 0,
            sourceCount: plan.blocks.filter((block) => block.included).length,
            recentMessageCount: plan.diagnostics.recentMessageCount,
            estimatedTokens: plan.budget.estimatedTokens,
            truncated: plan.budget.truncated,
            policyVersion: CONTEXT_POLICY_VERSION,
            deepResearch: true,
          });
        } catch {
          logError("context.build.failed", { requestId, code: operationalCodes.contextBuildFailed, stage: "context", durationMs: durationMs() });
          await releaseCreditsOnly();
          await persist("Response unavailable.", "error");
          enqueue("error", { error: safeError });
          return;
        }

        synthesisPromptChars = prompt?.reduce((sum, message) => sum + message.content.length, 0) ?? 8_000;

        // Research credits = mode + multi-call overhead. Preflight may already hold them.
        if (!weeklyUsageReserved) {
          const gate = await reserveUsageBeforeGeneration({
            supabase,
            userId,
            generationId: assistant.id,
            mode,
            usageKind: "research",
            requestId,
          });
          if (!gate.ok) {
            await persist(
              gate.code === operationalCodes.weeklyUsageLimitRejected
                ? "Weekly usage limit reached."
                : gate.code === operationalCodes.aiSpendLimitRejected
                  ? "AI spend budget reached."
                  : clientCancelled ? "Response stopped." : "Response unavailable.",
              gate.status === 429 || !clientCancelled ? "error" : "interrupted",
            );
            enqueue("error", { error: gate.error });
            return;
          }
          usageReservationMs = gate.usageReservationMs;
          spendReservedMicros = gate.spendReservedMicros;
          logInfo("weekly_usage.reservation.accepted", {
            requestId,
            logicalMode: mode,
            usageKind: "research",
            creditsCharged: gate.creditsCharged,
            creditsRemaining: gate.creditsRemaining,
            reservationLatencyMs: usageReservationMs,
            ...researchUsagePolicyFields(),
          });
        }

        if (aborter.signal.aborted || clientCancelled || userStopped) {
          await releaseCreditsOnly();
          await persist("Response stopped.", "interrupted");
          logInfo("research.interrupted", { requestId, stage: "pre_synthesis", durationMs: durationMs() });
          enqueue("status", { status: "interrupted" });
          return;
        }

        logInfo("research.synthesis.started", {
          requestId,
          sourceCount: citationSources.length,
          modelCallCount: research.metrics.modelCallCount + 1,
          ...researchUsagePolicyFields(),
        });
        enqueue("progress", { stage: "synthesizing" });

        let providerTimedOut = false;
        const elapsedBeforeSynthesis = Date.now() - responseStartedAt;
        const remainingBudget = Math.max(15_000, RESEARCH_ROUTE_BUDGET_MS - elapsedBeforeSynthesis);
        const synthesisTimeoutMs = Math.min(RESEARCH_SYNTHESIS_TIMEOUT_MS, remainingBudget);
        const timeout = setTimeout(() => {
          providerTimedOut = true;
          providerTimedOutRef.value = true;
          aborter.abort();
        }, synthesisTimeoutMs);
        providerStartedAt = Date.now();

        let responseStream: ReadableStream<Uint8Array>;
        try {
          synthesisStarted = true;
          responseStream = await chatProvider.stream(mode, prompt!, aborter.signal);
        } catch {
          clearTimeout(timeout);
          const interrupted = userStopped || clientCancelled || request.signal.aborted;
          if (interrupted) logWarn("chat.response.interrupted", { requestId, stage: "provider", status: "interrupted", durationMs: durationMs() });
          else {
            logError("chat.response.failed", { requestId, durationMs: durationMs(), stage: "provider", code: operationalCodes.aiProviderFailed });
            logWarn("research.failed", { requestId, category: "synthesis_provider", durationMs: durationMs(), code: operationalCodes.deepResearchFailed });
          }
          if (!interrupted) await releaseCreditsOnly();
          if (!userStopped) await persist(clientCancelled ? stoppedPlaceholder : "Response unavailable.", clientCancelled ? "interrupted" : "error");
          enqueue("error", { error: providerTimedOut ? timeoutError : safeError });
          return;
        }

        const usageStarted = await startWeeklyUsage({ supabase, generationId: assistant.id, requestId, logicalMode: mode });
        if (!usageStarted) {
          aborter.abort();
          await releaseCreditsOnly();
          await persist(clientCancelled ? "Response stopped." : "Response unavailable.", clientCancelled ? "interrupted" : "error");
          enqueue("error", { error: safeError });
          clearTimeout(timeout);
          return;
        }

        const reasoningFilter = createReasoningStreamFilter();
        const citationFilter = createCitationStreamFilter(citationSources);
        let output = "";
        let completed = false;
        let sealed = false;
        let interruptedSave: Promise<"saved" | "stopped" | "failed"> | undefined;

        const publish = (text: string) => {
          if (!text) return;
          if (providerTtftMs === null) providerTtftMs = Date.now() - providerStartedAt;
          output += text;
          synthesisOutputChars = output.length;
          enqueue("delta", { text });
        };
        const feedModelText = (chunk: string) => {
          if (!chunk) return;
          publish(citationFilter.push(reasoningFilter.push(chunk)));
        };
        const logCitationStats = () => {
          logInfo("citation.references.parsed", {
            requestId,
            sourceCount: citationSources.length,
            citationCount: citationFilter.citationCount,
          });
          if (citationFilter.invalidCitationCount > 0) {
            logInfo("citation.references.invalid", {
              requestId,
              sourceCount: citationSources.length,
              invalidCitationCount: citationFilter.invalidCitationCount,
            });
          }
        };
        const seal = () => {
          if (sealed) return;
          sealed = true;
          const afterReasoning = reasoningFilter.finish();
          if (afterReasoning) publish(citationFilter.push(afterReasoning));
          publish(citationFilter.finish());
          logCitationStats();
        };
        const save = async (status: "complete" | "interrupted" | "error") => {
          seal();
          if (userStopped) return "stopped" as const;
          const content = output || (status === "interrupted" ? stoppedPlaceholder : "Response unavailable.");
          if (status === "interrupted") return (interruptedSave ??= persist(content, status));
          return persist(content, status);
        };

        try {
          // Re-announce context now that diagnostics exist (client already has start).
          if (context) {
            /* context was available at start only optionally; sources already sent */
          }
          for await (const item of readOpenAiSse(responseStream, aborter.signal)) {
            if (item.type === "done") {
              completed = true;
              finishReason = item.finishReason ?? "unspecified";
              if (item.usage) providerUsage = item.usage;
              break;
            }
            feedModelText(item.text);
          }
          seal();
          researchMetrics = {
            ...researchMetrics,
            modelCallCount: research.metrics.modelCallCount + 1,
            durationMs: Date.now() - responseStartedAt,
          };

          if (userStopped || clientCancelled || request.signal.aborted) {
            const saved = await save("interrupted");
            logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
            logInfo("research.interrupted", { requestId, durationMs: durationMs(), ...researchUsagePolicyFields() });
            if (!clientCancelled) enqueue(saved !== "failed" ? "status" : "error", saved !== "failed" ? { status: "interrupted" } : { error: safeError });
          } else if (completed && output.length > 0) {
            researchStatus = research.incompleteNotice ? "incomplete" : "complete";
            const saved = await save("complete");
            if (saved === "saved") {
              logInfo("chat.response.completed", { requestId, status: "complete", durationMs: durationMs(), deepResearch: true });
              logInfo("research.completed", {
                requestId,
                durationMs: durationMs(),
                searchQueryCount: researchMetrics.searchQueryCount,
                pagesFetched: researchMetrics.pagesFetched,
                evidenceCount: researchMetrics.evidenceCount,
                modelCallCount: researchMetrics.modelCallCount,
                followUpUsed: researchMetrics.followUpUsed,
                ...researchUsagePolicyFields(),
              });
              try {
                summaryMaintenance.complete(assistant.position);
              } catch {
                /* best effort */
              }
              enqueue("status", { status: "complete" });
            } else if (saved === "stopped") {
              logInfo("research.interrupted", { requestId, durationMs: durationMs() });
              enqueue("status", { status: "interrupted" });
            } else {
              await save("error");
              logError("chat.response.failed", {
                requestId,
                stage: "persist",
                code: operationalCodes.assistantPersistFailed,
                status: "error",
                durationMs: durationMs(),
              });
              enqueue("error", { error: safeError });
            }
          } else if ((await save("error")) === "stopped") {
            enqueue("status", { status: "interrupted" });
          } else {
            logError("chat.response.failed", {
              requestId,
              stage: "stream",
              code: operationalCodes.aiProviderFailed,
              status: "error",
              durationMs: durationMs(),
            });
            logWarn("research.failed", { requestId, category: "synthesis_empty", durationMs: durationMs(), code: operationalCodes.deepResearchFailed });
            enqueue("error", { error: safeError });
          }
        } catch (streamError) {
          if (streamError instanceof ProviderStreamError) finishReason = streamError.finishReason;
          else if (providerTimedOut) finishReason = "timeout";
          let saved: "saved" | "stopped" | "failed" = "failed";
          try {
            saved = await save(userStopped || clientCancelled || request.signal.aborted ? "interrupted" : "error");
          } catch {
            logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist" });
          }
          const interrupted = saved === "stopped" || userStopped || clientCancelled || request.signal.aborted;
          if (interrupted) {
            logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
            logInfo("research.interrupted", { requestId, durationMs: durationMs() });
          } else {
            logError("chat.response.failed", {
              requestId,
              stage: "stream",
              code: operationalCodes.aiProviderFailed,
              status: "error",
              durationMs: durationMs(),
            });
            logWarn("research.failed", { requestId, category: "synthesis_stream", durationMs: durationMs(), code: operationalCodes.deepResearchFailed });
          }
          if (!interrupted) {
            enqueue("error", {
              error: streamError instanceof ProviderStreamError ? streamError.message : providerTimedOut ? timeoutError : safeError,
            });
          } else if (!clientCancelled) {
            enqueue(saved !== "failed" ? "status" : "error", saved !== "failed" ? { status: "interrupted" } : { error: safeError });
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        logError("chat.response.failed", {
          requestId,
          stage: "research",
          code: operationalCodes.deepResearchFailed,
          durationMs: durationMs(),
        });
        logWarn("research.failed", {
          requestId,
          category: "exception",
          durationMs: durationMs(),
          code: operationalCodes.deepResearchFailed,
        });
        try {
          if (researchWorkStarted) await releaseCreditsOnly();
          else await releaseReservation();
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
        const spendBreakdown = estimateResearchSpendMicros({
          synthesisMode: mode,
          planMode: availablePlanMode,
          metrics: researchMetrics,
          synthesisUsage: providerUsage,
          synthesisPromptChars,
          synthesisOutputChars,
          synthesisStarted,
        });
        const costEstimate = withCostEstimate(
          mode,
          providerUsage
            ?? estimateUsageFromText({
              promptChars: synthesisPromptChars,
              outputChars: synthesisOutputChars,
            }),
        );
        if (!spendSettled) {
          await finalizeGenerationSpend({
            supabase,
            userId,
            generationId: assistant.id,
            actualMicros: spendBreakdown.actualMicros,
            requestId,
          });
          spendSettled = true;
        }
        logGenerationTelemetry({
          requestId,
          logicalMode: mode,
          provider: providerFor(mode),
          model: configuredModelLabel(mode),
          usageKind: "research",
          usage: costEstimate,
          providerTtftMs,
          generationDurationMs: Date.now() - providerStartedAt,
          totalDurationMs: Date.now() - requestStartedAt,
          finishReason,
          failureCategory: failureCategoryFrom({ finishReason, stage: "research" }),
          deepResearch: true,
          usageReservationMs,
          spendReservedMicros,
          spendAccepted: true,
        });
        logInfo("research.usage.summary", {
          requestId,
          ...researchUsagePolicyFields(),
          searchQueryCount: researchMetrics.searchQueryCount,
          pagesFetched: researchMetrics.pagesFetched,
          modelCallCount: researchMetrics.modelCallCount,
          spendPlannerMicros: spendBreakdown.plannerMicros,
          spendSearchMicros: spendBreakdown.searchMicros,
          spendSynthesisMicros: spendBreakdown.synthesisMicros,
          spendActualMicros: spendBreakdown.actualMicros,
        });
        clearInterval(stopWatch);
        aborter.abort();
        request.signal.removeEventListener("abort", onRequestAbort);
        try {
          summaryMaintenance.finish();
        } catch {
          /* best effort */
        }
        if (!clientCancelled) {
          enqueue("done", {});
          controller.close();
        }
      }
    },
    cancel() {
      clientCancelled = true;
      clearInterval(stopWatch);
      aborter.abort();
    },
  });

  return new Response(stream, { headers });
}
