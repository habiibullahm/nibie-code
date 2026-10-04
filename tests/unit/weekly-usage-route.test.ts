import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, auth, rpc } = vi.hoisted(() => ({ createClient: vi.fn(), auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
import { GET } from "@/app/api/usage/route";

describe("GET /api/usage", () => {
  beforeEach(() => {
    createClient.mockReset(); auth.mockReset(); rpc.mockReset();
    auth.mockResolvedValue({ data: { claims: { sub: "owner" } }, error: null });
    rpc.mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({
      data: { credits_used: 28, credits_remaining: 72, reset_at: "2026-10-05T00:00:00.000Z" }, error: null,
    }) });
    createClient.mockResolvedValue({ auth: { getClaims: auth }, rpc });
  });

  it("returns the server-owned allowance/reset with private no-store caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ creditsUsed: 28, creditsRemaining: 72, resetAt: "2026-10-05T00:00:00.000Z" });
    expect(rpc).toHaveBeenCalledWith("get_current_weekly_ai_usage");
  });

  it("rejects anonymous requests before the usage RPC", async () => {
    auth.mockResolvedValue({ data: null, error: new Error("missing session") });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed on missing, invalid, or impossible database usage data", async () => {
    rpc.mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({
      data: { credits_used: 101, credits_remaining: -1, reset_at: "not a date" }, error: null,
    }) });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Weekly usage is unavailable." });
  });
});
