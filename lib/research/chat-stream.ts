import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatProvider } from "@/lib/ai/provider";
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
import type { AttachmentContextInput, FileContextInput } from "@/lib/context/context-types";
import type { RoomContextInput } from "@/lib/context/room-context";
import { RESEARCH_WEB_TOKEN_CAP } from "@/lib/context/token-budget";
import { deferThreadSummaryMaintenance } from "@/lib/context/thread-summary-store";
import type { ThreadSummary } from "@/lib/context/context-types";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import type { UserPreferences } from "@/lib/preferences/types";
import { runDeepResearch } from "@/lib/research/orchestrator";
import { persistMessageResearch } from "@/lib/research/persist";
import { researchSynthesisInstruction } from "@/lib/research/synthesize";
import type { ResearchProgressStage, ResearchRunMetrics, ResearchRunStatus } from "@/lib/research/types";
import { researchUsagePolicyFields } from "@/lib/research/usage-policy";
import type { MemoryRecord, RecallOperationStatus } from "@/lib/recall/types";
import { weeklyCreditCost, WEEKLY_FREE_CREDIT_LIMIT } from "@/lib/usage/policy";
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
  room: RoomContextInput | null;
  files: FileContextInput[] | undefined;
  attachments: AttachmentContextInput[];
  memories: MemoryRecord[] | undefined;
  recallOperation: RecallOperationStatus;
  rows: { role: string; content: string; position: number }[];
};

/**
 * Deep Research generation path: early SSE start + progress stages, bounded orchestrator,
 * Citations V1 attach/stream/persist, Stop-aware, usage honesty via temporary_undercount_v1.
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
    room,
    files,
    attachments,
    memories,
    recallOperation,
    rows,
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

  const releaseReservation = async () => {
    try {
      const { error } = await supabase.rpc("release_weekly_ai_usage", { p_generation_id: assistant.id });
      if (error) logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    } catch {
      logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    }
  };

  const summaryMaintenance = deferThreadSummaryMaintenance({ supabase, conversationId, requestId });
  let usageReservationMs = 0;
  let providerStartedAt = Date.now();
  let providerTtftMs: number | null = null;
  let finishReason = "unspecified";
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
          await persist("Response stopped.", "interrupted");
          logInfo("research.interrupted", { requestId, stage: "start", durationMs: durationMs() });
          enqueue("status", { status: "interrupted" });
          return;
        }

        const research = await runDeepResearch({
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

        if (aborter.signal.aborted || userStopped || clientCancelled || research.status === "interrupted") {
          await persist(stoppedPlaceholder, "interrupted");
          logInfo("research.interrupted", { requestId, durationMs: durationMs(), ...researchUsagePolicyFields() });
          enqueue("status", { status: "interrupted" });
          return;
        }

        if (research.status === "failed" && research.evidence.length === 0 && !research.web.length) {
          // Transparent failure — do not hallucinate completed research.
          const message =
            research.incompleteNotice ??
            "Deep Research could not gather sources. Please try again later or switch to Normal.";
          citationSources = [];
          researchStatus = "failed";
          logWarn("research.failed", {
            requestId,
            category: research.metrics.incompleteReason ?? "failed",
            durationMs: durationMs(),
            code: operationalCodes.deepResearchFailed,
            ...researchUsagePolicyFields(),
          });
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
          await persist("Response unavailable.", "error");
          enqueue("error", { error: safeError });
          return;
        }

        // Reserve credits for synthesis only (temporary undercount of planner/search).
        const reservationStartedAt = Date.now();
        let reservation: {
          accepted: boolean;
          credits_charged: number;
          credits_used: number;
          credits_remaining: number;
          reset_at: string;
        } | null = null;
        let reservationError: unknown = null;
        try {
          const result = await supabase
            .rpc("reserve_weekly_ai_usage", {
              p_generation_id: assistant.id,
              p_logical_mode: mode,
            })
            .single<{
              accepted: boolean;
              credits_charged: number;
              credits_used: number;
              credits_remaining: number;
              reset_at: string;
            }>();
          reservation = result.data;
          reservationError = result.error;
        } catch {
          reservationError = new Error("Reservation request failed.");
        }
        usageReservationMs = Date.now() - reservationStartedAt;

        if (
          reservationError ||
          !reservation ||
          typeof reservation.accepted !== "boolean" ||
          !Number.isInteger(reservation.credits_remaining) ||
          reservation.credits_remaining < 0 ||
          reservation.credits_remaining > WEEKLY_FREE_CREDIT_LIMIT ||
          typeof reservation.reset_at !== "string" ||
          !Number.isFinite(Date.parse(reservation.reset_at))
        ) {
          logError("weekly_usage.reservation.failed", {
            requestId,
            logicalMode: mode,
            durationMs: usageReservationMs,
            code: operationalCodes.requestFailed,
          });
          await releaseReservation();
          await persist(clientCancelled ? "Response stopped." : "Response unavailable.", clientCancelled ? "interrupted" : "error");
          enqueue("error", { error: safeError });
          return;
        }
        if (!reservation.accepted) {
          logWarn("weekly_usage.limit.rejected", {
            requestId,
            logicalMode: mode,
            creditsCharged: 0,
            creditsRemaining: reservation.credits_remaining,
          });
          await persist("Weekly usage limit reached.", "error");
          enqueue("error", { error: "You've reached your weekly Nibie usage limit." });
          return;
        }
        if (reservation.credits_charged !== weeklyCreditCost[mode]) {
          logError("weekly_usage.reservation.failed", {
            requestId,
            logicalMode: mode,
            durationMs: usageReservationMs,
            reason: "policy_mismatch",
            code: operationalCodes.requestFailed,
          });
          await releaseReservation();
          await persist("Response unavailable.", "error");
          enqueue("error", { error: safeError });
          return;
        }
        logInfo("weekly_usage.reservation.accepted", {
          requestId,
          logicalMode: mode,
          creditsCharged: reservation.credits_charged,
          creditsRemaining: reservation.credits_remaining,
          reservationLatencyMs: usageReservationMs,
          ...researchUsagePolicyFields(),
        });

        if (aborter.signal.aborted || clientCancelled || userStopped) {
          await releaseReservation();
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
        const timeout = setTimeout(() => {
          providerTimedOut = true;
          providerTimedOutRef.value = true;
          aborter.abort();
        }, 120_000);
        providerStartedAt = Date.now();

        let responseStream: ReadableStream<Uint8Array>;
        try {
          responseStream = await chatProvider.stream(mode, prompt!, aborter.signal);
        } catch {
          clearTimeout(timeout);
          const interrupted = userStopped || clientCancelled || request.signal.aborted;
          if (interrupted) logWarn("chat.response.interrupted", { requestId, stage: "provider", status: "interrupted", durationMs: durationMs() });
          else {
            logError("chat.response.failed", { requestId, durationMs: durationMs(), stage: "provider", code: operationalCodes.aiProviderFailed });
            logWarn("research.failed", { requestId, category: "synthesis_provider", durationMs: durationMs(), code: operationalCodes.deepResearchFailed });
          }
          if (!interrupted) await releaseReservation();
          if (!userStopped) await persist(clientCancelled ? stoppedPlaceholder : "Response unavailable.", clientCancelled ? "interrupted" : "error");
          enqueue("error", { error: providerTimedOut ? timeoutError : safeError });
          return;
        }

        let usageStarted = false;
        try {
          const { data, error } = await supabase.rpc("start_weekly_ai_usage", { p_generation_id: assistant.id });
          usageStarted = data === true && !error;
        } catch {
          usageStarted = false;
        }
        if (!usageStarted) {
          logError("weekly_usage.start.failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
          aborter.abort();
          await releaseReservation();
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
          await persist("Response unavailable.", "error");
        } catch {
          /* ignore */
        }
        enqueue("error", { error: safeError });
      } finally {
        logInfo("chat.response.metrics", {
          requestId,
          logicalMode: mode,
          provider: providerFor(mode),
          providerTtftMs,
          generationDurationMs: Date.now() - providerStartedAt,
          appBeforeProviderMs: providerStartedAt - requestStartedAt,
          usageReservationMs,
          totalDurationMs: Date.now() - requestStartedAt,
          finishReason,
          deepResearch: true,
          ...researchUsagePolicyFields(),
          searchQueryCount: researchMetrics.searchQueryCount,
          pagesFetched: researchMetrics.pagesFetched,
          modelCallCount: researchMetrics.modelCallCount,
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
