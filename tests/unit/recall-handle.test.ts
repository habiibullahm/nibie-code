import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { upsertMemoryByKey, deactivateMatchingMemories } = vi.hoisted(() => ({
  upsertMemoryByKey: vi.fn(),
  deactivateMatchingMemories: vi.fn(),
}));

vi.mock("../../lib/recall/store", () => ({
  upsertMemoryByKey,
  deactivateMatchingMemories,
}));

vi.mock("../../lib/observability/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import { handleRecallTurn } from "../../lib/recall/handle";

describe("recall turn handle", () => {
  it("saves on explicit remember intent", async () => {
    upsertMemoryByKey.mockResolvedValue({
      memory: { id: "m1", type: "preference", content: "I prefer TypeScript" },
      error: null,
    });
    const result = await handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Remember that I prefer TypeScript",
      recallEnabled: true,
      requestId: "req-1",
    });
    expect(result).toEqual({ status: "save_succeeded", wrote: true, forgot: 0, degraded: false });
    expect(upsertMemoryByKey).toHaveBeenCalledOnce();
  });

  it("forgets on explicit forget intent", async () => {
    deactivateMatchingMemories.mockResolvedValue({ count: 1, error: null });
    const result = await handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Forget that I prefer TypeScript",
      recallEnabled: true,
      requestId: "req-2",
    });
    expect(result).toEqual({ status: "forget_succeeded", wrote: false, forgot: 1, degraded: false });
  });

  it("reports memory_disabled when recall is off but intent is present", async () => {
    upsertMemoryByKey.mockClear();
    const result = await handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Remember that I prefer TypeScript",
      recallEnabled: false,
      requestId: "req-3",
    });
    expect(result).toEqual({ status: "memory_disabled", wrote: false, forgot: 0, degraded: false });
    expect(upsertMemoryByKey).not.toHaveBeenCalled();
  });

  it("reports save_failed on store errors", async () => {
    upsertMemoryByKey.mockResolvedValue({ memory: null, error: "fail" });
    await expect(handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Remember that deploy is in Seoul",
      recallEnabled: true,
    })).resolves.toEqual({ status: "save_failed", wrote: false, forgot: 0, degraded: true });
  });

  it("reports forget_not_found when nothing matches", async () => {
    deactivateMatchingMemories.mockResolvedValue({ count: 0, error: null });
    await expect(handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Forget that Cedar uses PostgreSQL",
      recallEnabled: true,
    })).resolves.toEqual({ status: "forget_not_found", wrote: false, forgot: 0, degraded: false });
  });

  it("reports forget_failed when forget store errors", async () => {
    deactivateMatchingMemories.mockResolvedValue({ count: 0, error: "fail" });
    await expect(handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Forget that Cedar uses PostgreSQL",
      recallEnabled: true,
    })).resolves.toEqual({ status: "forget_failed", wrote: false, forgot: 0, degraded: true });
  });
});
