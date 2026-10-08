import { beforeEach, describe, expect, it, vi } from "vitest";

const { createActionAuditClient } = vi.hoisted(() => ({
  createActionAuditClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({ createActionAuditClient }));

import { POST } from "@/app/api/cron/reconcile-usage/route";

describe("reconcile-usage cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns 503 when CRON_SECRET is unset", async () => {
    const response = await POST(new Request("http://localhost/api/cron/reconcile-usage", { method: "POST" }));
    expect(response.status).toBe(503);
  });

  it("returns 401 for a missing or wrong bearer token", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const response = await POST(new Request("http://localhost/api/cron/reconcile-usage", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    }));
    expect(response.status).toBe(401);
  });

  it("invokes reconcile_stale_ai_usage with the service-role client", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const rpc = vi.fn(() => ({
      single: async () => ({ data: { weekly_released: 2, spend_released: 1 }, error: null }),
    }));
    createActionAuditClient.mockReturnValue({ rpc });
    const response = await POST(new Request("http://localhost/api/cron/reconcile-usage", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret", "content-type": "application/json" },
      body: JSON.stringify({ staleAfterSeconds: 120 }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      weeklyReleased: 2,
      spendReleased: 1,
      staleAfterSeconds: 120,
    });
    expect(rpc).toHaveBeenCalledWith("reconcile_stale_ai_usage", { p_stale_after_seconds: 120 });
  });
});
