import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { stopPollMs } from "@/lib/chat/stop";
import type { ChatModel } from "@/lib/chat/validation";
import { logInfo } from "@/lib/observability/logger";
import { finalizeGenerationSpend, releaseUsageHold, startWeeklyUsage } from "@/lib/usage/guards";

/** Local coordination only: conditional message writes and usage RPCs remain the database authority. */
export function createGenerationLifecycle(input: {
  requestSignal: AbortSignal;
  supabase: SupabaseClient;
  userId: string;
  generationId: string;
  requestId: string;
  mode: ChatModel;
  stopStage: "generation" | "action";
  durationMs: () => number;
}) {
  const { requestSignal, supabase, userId, generationId, requestId, mode } = input;
  const aborter = new AbortController();
  let clientCancelled = false;
  let userStopped = false;
  let providerTimedOut = false;
  let closed = false;
  let polling = false;
  let stopWatch: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const clearStopWatch = () => {
    clearInterval(stopWatch);
    stopWatch = undefined;
  };
  const clearProviderTimeout = () => {
    clearTimeout(timeout);
    timeout = undefined;
  };
  const onRequestAbort = () => {
    clientCancelled = true;
    clearStopWatch();
    aborter.abort();
  };
  requestSignal.addEventListener("abort", onRequestAbort, { once: true });
  if (requestSignal.aborted) onRequestAbort();

  const checkStopped = async () => {
    if (polling || closed || aborter.signal.aborted) return;
    polling = true;
    try {
      const { data, error } = await supabase.from("messages").select("status").eq("id", generationId).maybeSingle();
      if (closed || error || data?.status === "streaming" || userStopped || aborter.signal.aborted) return;
      userStopped = true;
      clearStopWatch();
      logInfo("chat.response.user_stopped", {
        requestId, reason: "user_stopped", stage: input.stopStage,
        status: data?.status ?? "missing", durationMs: input.durationMs(),
      });
      aborter.abort();
    } catch { /* retry on the next tick */ }
    finally { polling = false; }
  };

  // Cache promises before awaiting: overlapping cleanup paths must share the same RPC attempt.
  let usageStarted = false;
  let startPromise: Promise<boolean> | undefined;
  let releasePromise: Promise<void> | undefined;
  let settlePromise: Promise<boolean> | undefined;
  const startUsage = (): Promise<boolean> => {
    if (startPromise) return startPromise;
    if (releasePromise) return Promise.resolve(false);
    return startPromise ??= startWeeklyUsage({ supabase, generationId, requestId, logicalMode: mode })
      .then((started) => { usageStarted = started; return started; });
  };
  const releaseBeforeStart = (): Promise<void> => {
    if (usageStarted || settlePromise) return Promise.resolve();
    return releasePromise ??= (async () => {
      // A release racing start must wait for the database's start result before deciding whether to refund.
      if (startPromise && await startPromise) return;
      await releaseUsageHold({ supabase, userId, generationId, requestId, logicalMode: mode });
    })();
  };
  const settleSpend = async (actualMicros: number): Promise<boolean> => {
    if (!startPromise || !await startPromise) return false;
    return settlePromise ??= finalizeGenerationSpend({ supabase, userId, generationId, actualMicros, requestId });
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearStopWatch();
    clearProviderTimeout();
    requestSignal.removeEventListener("abort", onRequestAbort);
    aborter.abort();
  };

  return {
    signal: aborter.signal,
    get clientCancelled() { return clientCancelled; },
    get userStopped() { return userStopped; },
    get providerTimedOut() { return providerTimedOut; },
    watchForStop() {
      if (!closed && !aborter.signal.aborted && stopWatch === undefined) {
        stopWatch = setInterval(() => { void checkStopped(); }, stopPollMs);
      }
    },
    startProviderTimeout() {
      if (closed || timeout !== undefined) return;
      timeout = setTimeout(() => { providerTimedOut = true; aborter.abort(); }, 120_000);
    },
    clearProviderTimeout,
    stopWatching: clearStopWatch,
    abortProvider: () => aborter.abort(),
    cancel() { clientCancelled = true; cleanup(); },
    cleanup,
    startUsage,
    releaseBeforeStart,
    settleSpend,
  };
}
