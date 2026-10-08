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
import { citationSourcesIncludedInContext } from "@/lib/citations/included";
import { createCitationStreamFilter } from "@/lib/citations/parse";
import { citationViewsFromPrepared, persistMessageSources } from "@/lib/citations/persist";
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
  MAX_ACTIONS_PER_GENERATION,
  WEB_SEARCH_ACTION_ID,
  webSourcesFromActionResult,
} from "@/lib/actions/index";
import type { ActionRuntimeOutcome } from "@/lib/actions/types";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import type { UserPreferences } from "@/lib/preferences/types";
import type { MemoryRecord, RecallOperationStatus } from "@/lib/recall/types";
import { weeklyCreditCost, WEEKLY_FREE_CREDIT_LIMIT } from "@/lib/usage/policy";
import type { WebContextInput } from "@/lib/web/types";

const encoder = new TextEncoder();
const safeError = "Nibie couldn't complete that response. Please try again.";

function event(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type AutoWebActionChatInput = {
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
  webRouteReason: string;
  /** HTTP preflight already reserved this generation; do not reserve again. */
  weeklyUsageReserved?: boolean;
};

/**
 * Automatic Web Search via Action Runtime: early SSE (action_start → execute → action_result),
 * then context + provider synthesis. One Action per generation. Stop cancels the Action.
 */
export async function createAutoWebActionChatResponse(input: AutoWebActionChatInput): Promise<Response> {
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
    webRouteReason,
    weeklyUsageReserved = false,
  } = input;

  const headers = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" };
  const responseStartedAt = Date.now();
  const durationMs = () => Date.now() - responseStartedAt;

  const aborter = new AbortController();
  let clientCancelled = false;
  let userStopped = false;
  const onRequestAbort = () => {
    clientCancelled = true;
    aborter.abort();
  };
  request.signal.addEventListener("abort", onRequestAbort, { once: true });
  if (request.signal.aborted) onRequestAbort();

  let stopCheck: Promise<void> | null = null;
  const checkStopped = async () => {
    try {
      const { data, error } = await supabase.from("messages").select("status").eq("id", assistant.id).maybeSingle();
      if (error || data?.status === "streaming" || userStopped || aborter.signal.aborted) return;
      userStopped = true;
      clearInterval(stopWatch);
      logInfo("chat.response.user_stopped", {
        requestId,
        reason: "user_stopped",
        stage: "action",
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

  const replyStopped = async () => {
    const { data, error } = await supabase.from("messages").select("status").eq("id", assistant.id).maybeSingle();
    return !error && data?.status === "interrupted";
  };

  let citationSources: SourceReference[] = [];
  let citationViews: ReturnType<typeof citationViewsFromPrepared> = [];
  let citationSourcesPersisted = false;
  const persistCitationSourcesForKeptReply = async (keptContent: string) => {
    if (citationSourcesPersisted || !citationSources.length) return;
    if (!keptContent.trim() || keptContent === stoppedPlaceholder) return;
    citationSourcesPersisted = true;
    const savedSources = await persistMessageSources({
      supabase,
      userId,
      conversationId,
      messageId: assistant.id,
      sources: citationSources,
    });
    if (!savedSources.ok) {
      citationSourcesPersisted = false;
      logWarn("citation.sources.persist_failed", { requestId, sourceCount: citationSources.length });
    }
  };

  const persist = async (
    content: string,
    status: "complete" | "interrupted" | "error",
  ): Promise<"saved" | "stopped" | "failed"> => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .update({ content, status })
        .eq("id", assistant.id)
        .eq("status", "streaming")
        .select("id")
        .maybeSingle();
      if (!error && data) {
        if (status === "complete" || status === "interrupted") {
          await persistCitationSourcesForKeptReply(content);
        }
        return "saved";
      }
      if (!error && (await replyStopped())) {
        await persistCitationSourcesForKeptReply(content);
        return "stopped";
      }
      return "failed";
    } catch {
      return "failed";
    }
  };

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
  let providerTimedOut = false;
  const timeoutError = "The provider took too long to finish this response. Please try again.";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (type: string, data: unknown) => {
        if (!clientCancelled) controller.enqueue(encoder.encode(event(type, data)));
      };

      // Early start so the client can show Action status while web.search runs.
      enqueue("start", { id: assistant.id, position: assistant.position });
      enqueue("action_start", {
        actionId: WEB_SEARCH_ACTION_ID,
        runId: null,
        title: "Web Search",
      });

      try {
        if (clientCancelled || aborter.signal.aborted) {
          await releaseReservation();
          await persist("Response stopped.", "interrupted");
          enqueue("status", { status: "interrupted" });
          return;
        }

        const generationActionCount = { current: 0 };
        logInfo("web.route.decided", { requestId, search: true, reason: webRouteReason });
        logInfo("action.started", { requestId, actionId: WEB_SEARCH_ACTION_ID });
        const actionStartedAt = Date.now();
        const outcome: ActionRuntimeOutcome = await executeAction({
          actionId: WEB_SEARCH_ACTION_ID,
          rawInput: { query: userMessage.content },
          ctx: {
            userId,
            conversationId,
            roomId,
            messageId: assistant.id,
            requestId,
            signal: aborter.signal,
          },
          supabase,
          generationActionCount,
          timeoutMs: 45_000,
        });

        if (generationActionCount.current > MAX_ACTIONS_PER_GENERATION) {
          /* defensive — executeAction already enforces */
        }

        const actionDurationMs = Date.now() - actionStartedAt;
        if (outcome.status === "cancelled" || aborter.signal.aborted || userStopped || clientCancelled) {
          logInfo("action.cancelled", { requestId, actionId: WEB_SEARCH_ACTION_ID, durationMs: actionDurationMs });
          enqueue("action_error", {
            actionId: WEB_SEARCH_ACTION_ID,
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
            actionId: WEB_SEARCH_ACTION_ID,
            itemCount: outcome.result.items.length,
            durationMs: actionDurationMs,
          });
          enqueue("action_result", {
            actionId: WEB_SEARCH_ACTION_ID,
            runId: outcome.runId,
            status: "completed",
            summary: outcome.result.summary,
          });
        } else {
          logWarn("action.failed", {
            requestId,
            actionId: WEB_SEARCH_ACTION_ID,
            errorCode: outcome.result.errorCode ?? "execution_failed",
            durationMs: actionDurationMs,
            code: operationalCodes.webSearchFailed,
          });
          enqueue("action_error", {
            actionId: WEB_SEARCH_ACTION_ID,
            runId: outcome.runId,
            status: outcome.status === "failed" ? "failed" : outcome.status,
            errorCode: outcome.result.errorCode ?? "execution_failed",
          });
        }

        let web: WebContextInput[] | undefined;
        let preparedCitationSources: SourceReference[] = [];
        let webVerificationUnavailable = false;
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

        let prompt: ReturnType<typeof toProviderMessages> | undefined;
        let context: ReturnType<typeof buildContext>["diagnostics"] | undefined;
        try {
          const started = Date.now();
          // Truthfulness stays in authoritative policy; Action/web bodies stay in untrusted web fences.
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
          // Early start omitted diagnostics; send them now so the context panel matches ordinary chat.
          enqueue("context", { context });
          logInfo("context.built", {
            requestId,
            durationMs: Date.now() - started,
            webIncluded: plan.blocks.some((b) => b.id === "web" && b.included),
            webCount: web?.length ?? 0,
            sourceCount: plan.blocks.filter((b) => b.included).length,
            recentMessageCount: plan.diagnostics.recentMessageCount,
            estimatedTokens: plan.budget.estimatedTokens,
            truncated: plan.budget.truncated,
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

        if (clientCancelled || aborter.signal.aborted || userStopped) {
          await releaseReservation();
          await persist(stoppedPlaceholder, "interrupted");
          enqueue("status", { status: "interrupted" });
          return;
        }

        // Preflight may already hold this generation's reservation; never release-then-re-reserve.
        if (!weeklyUsageReserved) {
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
          });
        }

        if (clientCancelled || aborter.signal.aborted || userStopped) {
          await releaseReservation();
          await persist(stoppedPlaceholder, "interrupted");
          enqueue("status", { status: "interrupted" });
          return;
        }

        const timeout = setTimeout(() => {
          providerTimedOut = true;
          aborter.abort();
        }, 120_000);
        providerStartedAt = Date.now();
        let responseStream: ReadableStream<Uint8Array>;
        try {
          responseStream = await chatProvider.stream(mode, prompt, aborter.signal);
        } catch {
          clearTimeout(timeout);
          const interrupted = userStopped || clientCancelled || aborter.signal.aborted;
          if (interrupted) logWarn("chat.response.interrupted", { requestId, stage: "provider", status: "interrupted", durationMs: durationMs() });
          else logError("chat.response.failed", { requestId, durationMs: durationMs(), stage: "provider", code: operationalCodes.aiProviderFailed });
          if (!interrupted) await releaseReservation();
          if (!userStopped) {
            await persist(clientCancelled ? stoppedPlaceholder : "Response unavailable.", clientCancelled ? "interrupted" : "error");
          }
          if (interrupted) enqueue("status", { status: "interrupted" });
          else enqueue("error", { error: providerTimedOut ? timeoutError : safeError });
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
          clearTimeout(timeout);
          aborter.abort();
          await releaseReservation();
          await persist(clientCancelled ? "Response stopped." : "Response unavailable.", clientCancelled ? "interrupted" : "error");
          enqueue("error", { error: safeError });
          return;
        }

        // Re-announce start metadata now that context/sources exist (client already has the row).
        if (citationViews.length) enqueue("sources", { sources: citationViews });

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
          if (!clientCancelled) controller.enqueue(encoder.encode(event("delta", { text })));
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
          if (userStopped) {
            await persistCitationSourcesForKeptReply(output);
            return "stopped" as const;
          }
          const content = output || (status === "interrupted" ? stoppedPlaceholder : "Response unavailable.");
          if (status === "interrupted") return (interruptedSave ??= persist(content, status));
          return persist(content, status);
        };

        try {
          for await (const item of readOpenAiSse(responseStream, aborter.signal)) {
            if (item.type === "done") {
              completed = true;
              finishReason = item.finishReason ?? "unspecified";
              break;
            }
            feedModelText(item.text);
          }
          seal();
          if (userStopped || clientCancelled || aborter.signal.aborted) {
            const saved = await save("interrupted");
            logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
            if (!clientCancelled) {
              enqueue(saved !== "failed" ? "status" : "error", saved !== "failed" ? { status: "interrupted" } : { error: safeError });
            }
          } else if (completed && output.length > 0) {
            const saved = await save("complete");
            if (saved === "saved") {
              logInfo("chat.response.completed", { requestId, status: "complete", durationMs: durationMs() });
              try {
                summaryMaintenance.complete(assistant.position);
              } catch {
                /* best effort */
              }
              enqueue("status", { status: "complete" });
            } else if (saved === "stopped") {
              enqueue("status", { status: "interrupted" });
            } else {
              await save("error");
              enqueue("error", { error: safeError });
            }
          } else if ((await save("error")) === "stopped") {
            enqueue("status", { status: "interrupted" });
          } else {
            enqueue("error", { error: safeError });
          }
        } catch (error) {
          if (error instanceof ProviderStreamError) finishReason = error.finishReason;
          else if (providerTimedOut) finishReason = "timeout";
          let saved: "saved" | "stopped" | "failed" = "failed";
          try {
            saved = await save(userStopped || clientCancelled || aborter.signal.aborted ? "interrupted" : "error");
          } catch {
            logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist" });
          }
          const interrupted = saved === "stopped" || userStopped || clientCancelled || aborter.signal.aborted;
          if (interrupted) {
            if (!clientCancelled) enqueue(saved !== "failed" ? "status" : "error", saved !== "failed" ? { status: "interrupted" } : { error: safeError });
          } else {
            enqueue("error", {
              error: error instanceof ProviderStreamError ? error.message : providerTimedOut ? timeoutError : safeError,
            });
          }
        } finally {
          clearTimeout(timeout);
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
            outputChars: output.length,
            streamCompleted: completed,
            actionId: WEB_SEARCH_ACTION_ID,
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
        clearInterval(stopWatch);
        aborter.abort();
        request.signal.removeEventListener("abort", onRequestAbort);
        try {
          summaryMaintenance.finish();
        } catch {
          /* best effort */
        }
        if (!clientCancelled) {
          controller.enqueue(encoder.encode(event("done", {})));
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
