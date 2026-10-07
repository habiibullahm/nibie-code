import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getWebSearchConfig } from "@/lib/web/config";

const configured = {
  WEB_SEARCH_PROVIDER: "tavily",
  TAVILY_API_KEY: "tvly-test-secret",
};

describe("getWebSearchConfig", () => {
  it("returns null when provider or key is unset", () => {
    expect(getWebSearchConfig({})).toBeNull();
    expect(getWebSearchConfig({ WEB_SEARCH_PROVIDER: "tavily" })).toBeNull();
    expect(getWebSearchConfig({ TAVILY_API_KEY: "tvly-test-secret" })).toBeNull();
    expect(getWebSearchConfig({ WEB_SEARCH_PROVIDER: "  ", TAVILY_API_KEY: "tvly-test-secret" })).toBeNull();
    expect(getWebSearchConfig({ WEB_SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "  " })).toBeNull();
  });

  it("returns null for an unsupported provider id", () => {
    expect(getWebSearchConfig({ ...configured, WEB_SEARCH_PROVIDER: "brave" })).toBeNull();
    expect(getWebSearchConfig({ ...configured, WEB_SEARCH_PROVIDER: "openai" })).toBeNull();
  });

  it("accepts tavily case-insensitively and applies V1 defaults", () => {
    expect(getWebSearchConfig({ ...configured, WEB_SEARCH_PROVIDER: "Tavily" })).toEqual({
      providerId: "tavily",
      apiKey: "tvly-test-secret",
      maxResults: 8,
      maxPages: 4,
      maxSources: 5,
    });
  });

  it("applies bound overrides within range and falls back on invalid values", () => {
    expect(
      getWebSearchConfig({
        ...configured,
        WEB_SEARCH_MAX_RESULTS: "6",
        WEB_FETCH_MAX_PAGES: "3",
        WEB_CONTEXT_MAX_SOURCES: "2",
      }),
    ).toMatchObject({ maxResults: 6, maxPages: 3, maxSources: 2 });

    expect(
      getWebSearchConfig({
        ...configured,
        WEB_SEARCH_MAX_RESULTS: "0",
        WEB_FETCH_MAX_PAGES: "999",
        WEB_CONTEXT_MAX_SOURCES: "nope",
      }),
    ).toMatchObject({ maxResults: 8, maxPages: 4, maxSources: 5 });
  });

  it("never embeds secret values in thrown messages (soft-fail only)", () => {
    expect(() => getWebSearchConfig({ ...configured, WEB_SEARCH_PROVIDER: "bad-secret-provider" })).not.toThrow();
    expect(getWebSearchConfig({ ...configured, WEB_SEARCH_PROVIDER: "bad-secret-provider" })).toBeNull();
  });
});
