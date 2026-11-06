import { describe, expect, it } from "vitest";
import { mapProviderFailure } from "../../lib/ai/provider-error";

describe("provider failure map", () => {
  it("maps auth, balance, and rate limit without copying the provider message", () => {
    expect(mapProviderFailure(401, null).code).toBe("authentication_failed");
    expect(mapProviderFailure(403, null).code).toBe("authentication_failed");
    expect(mapProviderFailure(402, null).code).toBe("insufficient_balance");
    expect(mapProviderFailure(400, "insufficient_quota").code).toBe("insufficient_balance");
    expect(mapProviderFailure(429, null).code).toBe("rate_limited");
    expect(mapProviderFailure(500, "sk-secret").code).toBe("unavailable");
    expect(mapProviderFailure(400, "sk-secret").message).not.toContain("sk-");
  });
});
