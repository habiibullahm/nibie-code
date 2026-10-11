import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerationLifecycle } from "@/lib/chat/orchestration/generation-lifecycle";
import { stopPollMs } from "@/lib/chat/stop";

const usage = vi.hoisted(() => ({ start: vi.fn(), release: vi.fn(), settle: vi.fn() }));
vi.mock("@/lib/usage/guards", () => ({ startWeeklyUsage: usage.start, releaseUsageHold: usage.release, finalizeGenerationSpend: usage.settle }));
vi.mock("@/lib/observability/logger", () => ({ logInfo: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const request = new AbortController();
  const read = vi.fn(async (): Promise<{ data: { status: string } | null; error: object | null }> => ({ data: { status: "streaming" }, error: null }));
  const query = { select: () => query, eq: vi.fn(() => query), maybeSingle: read };
  const lifecycle = createGenerationLifecycle({
    requestSignal: request.signal,
    supabase: { from: () => query } as unknown as SupabaseClient,
    userId: "owner", generationId: "assistant", requestId: "request", mode: "Balanced",
    stopStage: "generation", durationMs: () => 10,
  });
  return { lifecycle, request, read, query };
}

beforeEach(() => {
  vi.useFakeTimers();
  usage.start.mockReset().mockResolvedValue(true);
  usage.release.mockReset().mockResolvedValue(undefined);
  usage.settle.mockReset().mockResolvedValue(true);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("generation cancellation and cleanup", () => {
  it("an already aborted request cancels immediately without starting a Stop watch", () => {
    const request = new AbortController();
    request.abort();
    const lifecycle = createGenerationLifecycle({
      requestSignal: request.signal, supabase: {} as SupabaseClient,
      userId: "owner", generationId: "assistant", requestId: "request", mode: "Fast",
      stopStage: "action", durationMs: () => 0,
    });
    lifecycle.watchForStop();
    expect(lifecycle.clientCancelled).toBe(true);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    lifecycle.cleanup();
  });

  it.each(["interrupted", "complete", "error", "missing"])("the database's %s row cancels the generation without claiming a browser disconnect", async (status) => {
    const { lifecycle, read, query } = fixture();
    read.mockResolvedValue({ data: status === "missing" ? null : { status }, error: null });
    lifecycle.watchForStop();
    await vi.advanceTimersByTimeAsync(stopPollMs);
    expect(query.eq).toHaveBeenCalledWith("id", "assistant");
    expect(lifecycle.userStopped).toBe(true);
    expect(lifecycle.clientCancelled).toBe(false);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    lifecycle.cleanup();
  });

  it("retries a failed Stop read instead of treating it as a Stop", async () => {
    const { lifecycle, read } = fixture();
    read.mockRejectedValueOnce(new Error("connection lost"));
    read.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    lifecycle.watchForStop();
    await vi.advanceTimersByTimeAsync(stopPollMs * 2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(lifecycle.signal.aborted).toBe(false);
    read.mockResolvedValueOnce({ data: { status: "interrupted" }, error: null });
    await vi.advanceTimersByTimeAsync(stopPollMs);
    expect(lifecycle.userStopped).toBe(true);
    lifecycle.cleanup();
  });

  it("never overlaps Stop reads and ignores a read that completes after cleanup", async () => {
    const { lifecycle, read } = fixture();
    const pending = deferred<Awaited<ReturnType<typeof read>>>();
    read.mockReturnValueOnce(pending.promise);
    lifecycle.watchForStop();
    lifecycle.watchForStop();
    await vi.advanceTimersByTimeAsync(stopPollMs * 3);
    expect(read).toHaveBeenCalledTimes(1);
    lifecycle.cleanup();
    pending.resolve({ data: { status: "interrupted" }, error: null });
    await vi.advanceTimersByTimeAsync(stopPollMs);
    expect(lifecycle.userStopped).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("times out synthesis after 120 seconds without timing out the preceding Action", async () => {
    const { lifecycle } = fixture();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(lifecycle.signal.aborted).toBe(false);
    lifecycle.startProviderTimeout();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(lifecycle.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycle.providerTimedOut).toBe(true);
    expect(lifecycle.clientCancelled).toBe(false);
    expect(lifecycle.userStopped).toBe(false);
    lifecycle.cleanup();
  });

  it("consumer cancellation clears both timers and removes the request listener once", () => {
    const { lifecycle, request } = fixture();
    const remove = vi.spyOn(request.signal, "removeEventListener");
    lifecycle.watchForStop();
    lifecycle.startProviderTimeout();
    expect(vi.getTimerCount()).toBe(2);
    lifecycle.cancel();
    lifecycle.cleanup();
    expect(lifecycle.clientCancelled).toBe(true);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("a request abort stops polling and aborts upstream independently of stream cancellation", async () => {
    const { lifecycle, request, read } = fixture();
    lifecycle.watchForStop();
    request.abort();
    await vi.advanceTimersByTimeAsync(stopPollMs * 2);
    expect(lifecycle.clientCancelled).toBe(true);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(read).not.toHaveBeenCalled();
    lifecycle.cleanup();
  });
});

describe("generation usage coordination", () => {
  it("coalesces start and settlement attempts, keeping the first actual spend", async () => {
    const { lifecycle } = fixture();
    const pending = deferred<boolean>();
    usage.settle.mockReturnValueOnce(pending.promise);
    await Promise.all([lifecycle.startUsage(), lifecycle.startUsage()]);
    const settlements = [lifecycle.settleSpend(123), lifecycle.settleSpend(456)];
    await Promise.resolve();
    expect(usage.start).toHaveBeenCalledTimes(1);
    expect(usage.settle).toHaveBeenCalledTimes(1);
    expect(usage.settle).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", generationId: "assistant", actualMicros: 123 }));
    pending.resolve(true);
    await expect(Promise.all(settlements)).resolves.toEqual([true, true]);
    await lifecycle.releaseBeforeStart();
    expect(usage.release).not.toHaveBeenCalled();
    lifecycle.cleanup();
  });

  it("coalesces overlapping pre-start releases and prevents a released hold from starting", async () => {
    const { lifecycle } = fixture();
    const pending = deferred<void>();
    usage.release.mockReturnValueOnce(pending.promise);
    const releases = [lifecycle.releaseBeforeStart(), lifecycle.releaseBeforeStart()];
    expect(usage.release).toHaveBeenCalledTimes(1);
    await expect(lifecycle.startUsage()).resolves.toBe(false);
    expect(usage.start).not.toHaveBeenCalled();
    pending.resolve();
    await Promise.all(releases);
    lifecycle.cleanup();
  });

  it.each([true, false])("a release racing usage start waits for the %s start result before refunding", async (started) => {
    const { lifecycle } = fixture();
    const pending = deferred<boolean>();
    usage.start.mockReturnValueOnce(pending.promise);
    const start = lifecycle.startUsage();
    const release = lifecycle.releaseBeforeStart();
    expect(usage.release).not.toHaveBeenCalled();
    pending.resolve(started);
    await expect(start).resolves.toBe(started);
    await release;
    expect(usage.release).toHaveBeenCalledTimes(started ? 0 : 1);
    await expect(lifecycle.startUsage()).resolves.toBe(started);
    expect(usage.start).toHaveBeenCalledTimes(1);
    lifecycle.cleanup();
  });

  it("never settles a hold before a successful usage start", async () => {
    const { lifecycle } = fixture();
    await expect(lifecycle.settleSpend(123)).resolves.toBe(false);
    usage.start.mockResolvedValueOnce(false);
    await lifecycle.startUsage();
    await expect(lifecycle.settleSpend(123)).resolves.toBe(false);
    expect(usage.settle).not.toHaveBeenCalled();
    await Promise.all([lifecycle.releaseBeforeStart(), lifecycle.releaseBeforeStart()]);
    expect(usage.release).toHaveBeenCalledTimes(1);
    lifecycle.cleanup();
  });

  it("settles started usage after cancellation and never refunds it, even if settlement fails", async () => {
    const { lifecycle } = fixture();
    await lifecycle.startUsage();
    lifecycle.cancel();
    usage.settle.mockResolvedValueOnce(false);
    await expect(lifecycle.settleSpend(123)).resolves.toBe(false);
    await expect(lifecycle.settleSpend(456)).resolves.toBe(false);
    await lifecycle.releaseBeforeStart();
    expect(usage.settle).toHaveBeenCalledTimes(1);
    expect(usage.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
