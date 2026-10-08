import { beforeEach, describe, expect, it, vi } from "vitest";
import { reserveUsageBeforeGeneration, releaseUsageHold } from "@/lib/usage/guards";
import { operationalCodes } from "@/lib/observability/codes";

function rpcClient(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  return {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      const run = handlers[name];
      if (!run) return { single: async () => ({ data: null, error: { message: `missing ${name}` } }) };
      const result = run(args);
      return {
        single: async () => result,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
    }),
  };
}

describe("usage reservation / reconcile failure paths", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("accepts chat credits then spend, returning reserved micros", async () => {
    const supabase = rpcClient({
      reserve_weekly_ai_usage: () => ({
        data: { accepted: true, credits_charged: 3, credits_used: 3, credits_remaining: 497, reset_at: "2026-10-12T00:00:00.000Z" },
        error: null,
      }),
      reserve_ai_spend: () => ({
        data: { accepted: true, reserved_micros: 150_000, user_remaining_micros: 4_850_000, global_remaining_micros: 49_850_000 },
        error: null,
      }),
    });
    const gate = await reserveUsageBeforeGeneration({
      supabase: supabase as never,
      generationId: "11111111-1111-4111-8111-111111111111",
      mode: "Balanced",
      usageKind: "chat",
      requestId: "req-test",
    });
    expect(gate).toMatchObject({ ok: true, creditsCharged: 3, spendReservedMicros: 150_000 });
    expect(supabase.rpc).toHaveBeenCalledWith("reserve_weekly_ai_usage", expect.objectContaining({ p_usage_kind: "chat" }));
    expect(supabase.rpc).toHaveBeenCalledWith("reserve_ai_spend", expect.objectContaining({ p_reserved_micros: expect.any(Number) }));
  });

  it("rejects when weekly credits are exhausted without calling the provider spend path further after reject", async () => {
    const supabase = rpcClient({
      reserve_weekly_ai_usage: () => ({
        data: { accepted: false, credits_charged: 0, credits_used: 500, credits_remaining: 0, reset_at: "2026-10-12T00:00:00.000Z" },
        error: null,
      }),
    });
    const gate = await reserveUsageBeforeGeneration({
      supabase: supabase as never,
      generationId: "11111111-1111-4111-8111-111111111111",
      mode: "High",
      usageKind: "research",
      requestId: "req-quota",
    });
    expect(gate).toMatchObject({
      ok: false,
      status: 429,
      code: operationalCodes.weeklyUsageLimitRejected,
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith("reserve_ai_spend", expect.anything());
  });

  it("coerces bigint spend micros returned as strings from the RPC", async () => {
    const supabase = rpcClient({
      reserve_weekly_ai_usage: () => ({
        data: { accepted: true, credits_charged: 3, credits_used: 3, credits_remaining: 497, reset_at: "2026-10-12T00:00:00.000Z" },
        error: null,
      }),
      reserve_ai_spend: () => ({
        data: {
          accepted: true,
          reserved_micros: "150000",
          user_remaining_micros: "4850000",
          global_remaining_micros: "49850000",
        },
        error: null,
      }),
    });
    const gate = await reserveUsageBeforeGeneration({
      supabase: supabase as never,
      generationId: "11111111-1111-4111-8111-111111111111",
      mode: "Balanced",
      usageKind: "chat",
      requestId: "req-bigint",
    });
    expect(gate).toMatchObject({ ok: true, creditsCharged: 3, spendReservedMicros: 150_000 });
  });

  it("releases weekly credits when dollar spend reservation is rejected", async () => {
    const releases: string[] = [];
    const supabase = rpcClient({
      reserve_weekly_ai_usage: () => ({
        data: { accepted: true, credits_charged: 12, credits_used: 12, credits_remaining: 488, reset_at: "2026-10-12T00:00:00.000Z" },
        error: null,
      }),
      reserve_ai_spend: () => ({
        data: { accepted: false, reserved_micros: 0, user_remaining_micros: 0, global_remaining_micros: 0 },
        error: null,
      }),
      release_weekly_ai_usage: (args) => {
        releases.push(`weekly:${args.p_generation_id}`);
        return { data: true, error: null };
      },
      release_ai_spend: (args) => {
        releases.push(`spend:${args.p_generation_id}`);
        return { data: true, error: null };
      },
    });
    const gate = await reserveUsageBeforeGeneration({
      supabase: supabase as never,
      generationId: "22222222-2222-4222-8222-222222222222",
      mode: "High",
      usageKind: "research",
      requestId: "req-spend",
    });
    expect(gate).toMatchObject({
      ok: false,
      status: 429,
      code: operationalCodes.aiSpendLimitRejected,
    });
    expect(releases).toContain("weekly:22222222-2222-4222-8222-222222222222");
  });

  it("releases both spend and weekly holds on cleanup", async () => {
    const calls: string[] = [];
    const supabase = rpcClient({
      release_ai_spend: () => {
        calls.push("spend");
        return { data: true, error: null };
      },
      release_weekly_ai_usage: () => {
        calls.push("weekly");
        return { data: true, error: null };
      },
    });
    await releaseUsageHold({
      supabase: supabase as never,
      generationId: "33333333-3333-4333-8333-333333333333",
      requestId: "req-release",
      logicalMode: "Fast",
    });
    expect(calls).toEqual(["spend", "weekly"]);
  });

  it("fails closed when research credit policy mismatches the DB charge", async () => {
    const supabase = rpcClient({
      reserve_weekly_ai_usage: () => ({
        data: { accepted: true, credits_charged: 6, credits_used: 6, credits_remaining: 494, reset_at: "2026-10-12T00:00:00.000Z" },
        error: null,
      }),
      release_weekly_ai_usage: () => ({ data: true, error: null }),
      release_ai_spend: () => ({ data: true, error: null }),
    });
    const gate = await reserveUsageBeforeGeneration({
      supabase: supabase as never,
      generationId: "44444444-4444-4444-8444-444444444444",
      mode: "High",
      usageKind: "research",
      requestId: "req-mismatch",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.status).toBe(503);
  });
});
