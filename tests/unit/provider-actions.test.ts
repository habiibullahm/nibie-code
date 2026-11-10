import { describe, expect, it } from "vitest";
import { parseProviderWrite } from "../../lib/providers/validation";

describe("provider write validation", () => {
  it("accepts Nibie Router and strips a blank update key", () => {
    const parsed = parseProviderWrite({
      providerType: "nibie_router",
      name: "Nibie Router",
      baseUrl: "https://router.nibie.app/v1",
      apiKey: "nr-key",
      headers: [{ name: "X-Title", value: "nibie" }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.keys(parsed.data).sort()).toEqual(["apiKey", "baseUrl", "headers", "name", "providerType"]);
    expect(parsed.data).not.toHaveProperty("secret");
    expect(parsed.data).not.toHaveProperty("ciphertext");
  });

  it("rejects a secret-looking header name and a non-https custom URL", () => {
    expect(parseProviderWrite({
      providerType: "openai_compatible",
      name: "Custom",
      baseUrl: "http://example.com/v1",
      apiKey: "k",
    }).success).toBe(false);
    expect(parseProviderWrite({
      providerType: "nibie_router",
      name: "Nibie Router",
      baseUrl: "https://router.nibie.app/v1",
      apiKey: "k",
      headers: [{ name: "Authorization", value: "Bearer x" }],
    }).success).toBe(false);
  });
});
