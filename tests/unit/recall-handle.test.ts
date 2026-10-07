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
    expect(result).toEqual({ wrote: true, forgot: 0, degraded: false });
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
    expect(result).toEqual({ wrote: false, forgot: 1, degraded: false });
  });

  it("does nothing when recall is disabled", async () => {
    upsertMemoryByKey.mockClear();
    const result = await handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Remember that I prefer TypeScript",
      recallEnabled: false,
      requestId: "req-3",
    });
    expect(result).toEqual({ wrote: false, forgot: 0, degraded: false });
    expect(upsertMemoryByKey).not.toHaveBeenCalled();
  });

  it("soft-fails store errors without throwing", async () => {
    upsertMemoryByKey.mockResolvedValue({ memory: null, error: "fail" });
    await expect(handleRecallTurn({
      supabase: {} as never,
      userId: "owner",
      message: "Remember that deploy is in Seoul",
      recallEnabled: true,
    })).resolves.toEqual({ wrote: false, forgot: 0, degraded: true });
  });
});
