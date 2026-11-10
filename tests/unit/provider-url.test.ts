import { describe, expect, it } from "vitest";
import { assertProviderBaseUrl } from "../../lib/ai/provider-url";

describe("provider base url", () => {
  it("locks Nibie Router and accepts a public https custom host", () => {
    expect(assertProviderBaseUrl("nibie_router", "https://router.nibie.app/v1")).toBe("https://router.nibie.app/v1");
    expect(assertProviderBaseUrl("openai_compatible", "https://example.com/v1/")).toBe("https://example.com/v1");
  });

  it("rejects other Nibie Router hosts, http, userinfo, and local targets", () => {
    expect(() => assertProviderBaseUrl("nibie_router", "https://evil.example/v1")).toThrow(/Nibie Router/);
    expect(() => assertProviderBaseUrl("openai_compatible", "http://example.com/v1")).toThrow(/HTTPS/);
    expect(() => assertProviderBaseUrl("openai_compatible", "https://user:pass@example.com/v1")).toThrow(/credentials/);
    for (const url of ["https://localhost/v1", "https://127.0.0.1/v1", "https://10.1.2.3/v1", "https://169.254.169.254/v1", "https://host.local/v1"]) {
      expect(() => assertProviderBaseUrl("openai_compatible", url)).toThrow(/not allowed/);
    }
  });
});
