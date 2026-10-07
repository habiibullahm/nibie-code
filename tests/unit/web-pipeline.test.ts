import { afterEach, describe, expect, it, vi } from "vitest";
import { runWebSearchPipeline, type WebSearchConfig, type WebSearchProvider } from "@/lib/web/pipeline";
import { selectFinalSources, selectSearchResults, selectUrlsToFetch } from "@/lib/web/select";
import type { WebSearchResult } from "@/lib/web/types";
import { WebFetchError } from "@/lib/web/fetch-page";

afterEach(() => {
  vi.restoreAllMocks();
});

function result(partial: Partial<WebSearchResult> & Pick<WebSearchResult, "url" | "rank">): WebSearchResult {
  return {
    title: partial.title ?? `Title ${partial.rank}`,
    url: partial.url,
    snippet: partial.snippet ?? `Snippet for ${partial.url}`,
    rank: partial.rank,
    domain: partial.domain ?? new URL(partial.url).hostname,
    publishedAt: partial.publishedAt ?? null,
  };
}

const config: WebSearchConfig = {
  providerId: "tavily",
  apiKey: "test-key",
  maxResults: 8,
  maxPages: 4,
  maxSources: 5,
};

function mockProvider(results: WebSearchResult[] | (() => Promise<WebSearchResult[]>)): WebSearchProvider {
  return {
    id: "tavily",
    searchWeb: async () => (typeof results === "function" ? results() : results),
  };
}

describe("select bounds", () => {
  it("caps search results to 5–8 and dedupes URLs", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      result({ url: `https://example.com/${i}`, rank: i + 1 }),
    );
    many.push(result({ url: "https://example.com/0", rank: 99 }));
    expect(selectSearchResults(many, 8)).toHaveLength(8);
    expect(selectSearchResults(many, 3)).toHaveLength(5); // floor at 5
    expect(selectSearchResults(many, 100)).toHaveLength(8);
  });

  it("selects 2–4 fetch URLs preferring unique domains", () => {
    const results = [
      result({ url: "https://a.com/1", rank: 1, domain: "a.com" }),
      result({ url: "https://a.com/2", rank: 2, domain: "a.com" }),
      result({ url: "https://b.com/1", rank: 3, domain: "b.com" }),
      result({ url: "https://c.com/1", rank: 4, domain: "c.com" }),
      result({ url: "https://d.com/1", rank: 5, domain: "d.com" }),
    ];
    const picked = selectUrlsToFetch(results, 4);
    expect(picked).toHaveLength(4);
    expect(picked.map((r) => r.domain)).toEqual(["a.com", "b.com", "c.com", "d.com"]);
  });

  it("hard-caps final sources at 5", () => {
    const sources = Array.from({ length: 7 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `t${i}`,
      domain: "example.com",
      retrieval: "web_search" as const,
      text: `body ${i}`,
    }));
    expect(selectFinalSources(sources, 5)).toHaveLength(5);
    expect(selectFinalSources(sources, 99)).toHaveLength(5);
  });
});

describe("runWebSearchPipeline", () => {
  it("degrades when provider or config is missing", async () => {
    const signal = AbortSignal.timeout(5_000);
    expect(
      await runWebSearchPipeline("latest news", {
        signal,
        provider: null,
        config,
      }),
    ).toMatchObject({
      sources: [],
      degraded: true,
      failureCategory: "provider_unconfigured",
      searchResultCount: 0,
      pagesFetched: 0,
    });

    expect(
      await runWebSearchPipeline("latest news", {
        signal,
        provider: mockProvider([]),
        config: null,
      }),
    ).toMatchObject({ failureCategory: "provider_unconfigured", degraded: true });
  });

  it("degrades to empty on provider search failure", async () => {
    const provider = mockProvider(async () => {
      throw new Error("upstream down");
    });
    const out = await runWebSearchPipeline("current CEO of Acme", {
      signal: AbortSignal.timeout(5_000),
      provider,
      config,
      fetchPage: vi.fn(),
    });
    expect(out).toMatchObject({
      sources: [],
      degraded: true,
      failureCategory: "provider_error",
      pagesFetched: 0,
    });
  });

  it("degrades to empty on provider timeout", async () => {
    const provider = mockProvider(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const out = await runWebSearchPipeline("latest release", {
      signal: AbortSignal.timeout(5_000),
      provider,
      config,
      fetchPage: vi.fn(),
    });
    expect(out.failureCategory).toBe("timeout");
    expect(out.sources).toEqual([]);
  });

  it("uses snippets when all page fetches fail", async () => {
    const results = [
      result({ url: "https://news.example/a", rank: 1, domain: "news.example", snippet: "Snippet A about markets." }),
      result({ url: "https://wire.example/b", rank: 2, domain: "wire.example", snippet: "Snippet B about markets." }),
      result({ url: "https://press.example/c", rank: 3, domain: "press.example", snippet: "Snippet C about markets." }),
    ];
    const fetchPage = vi.fn(async () => {
      throw new WebFetchError("ssrf_blocked", "blocked_ip");
    });
    const out = await runWebSearchPipeline("latest market news", {
      signal: AbortSignal.timeout(5_000),
      provider: mockProvider(results),
      config: { ...config, maxPages: 2, maxSources: 5 },
      fetchPage,
    });
    expect(out.degraded).toBe(true);
    expect(out.pagesFetched).toBe(0);
    expect(out.searchResultCount).toBeGreaterThan(0);
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources.every((s) => s.retrieval === "web_snippet_only")).toBe(true);
    expect(out.sources[0]?.text).toContain("Snippet");
    expect(out.failureCategory).toBe("ssrf_blocked");
  });

  it("returns fetched page text as web_search sources", async () => {
    const results = [
      result({ url: "https://a.example/1", rank: 1, domain: "a.example" }),
      result({ url: "https://b.example/2", rank: 2, domain: "b.example" }),
      result({ url: "https://c.example/3", rank: 3, domain: "c.example" }),
    ];
    const fetchPage = vi.fn(async (url: string) => ({
      url,
      finalUrl: url,
      contentType: "text/html",
      body: `<html><body><article><p>Fetched body for ${url}</p><script>ignore()</script></article></body></html>`,
    }));
    const out = await runWebSearchPipeline("latest TypeScript release", {
      signal: AbortSignal.timeout(5_000),
      provider: mockProvider(results),
      config: { ...config, maxPages: 2, maxSources: 5 },
      fetchPage,
    });
    expect(out.degraded).toBe(false);
    expect(out.pagesFetched).toBe(2);
    expect(out.sources).toHaveLength(2);
    expect(out.sources.every((s) => s.retrieval === "web_search")).toBe(true);
    expect(out.sources[0]?.text).toContain("Fetched body");
    expect(out.sources[0]?.text).not.toContain("ignore()");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("partial fetch success fills remaining with snippets and stays ≤5", async () => {
    const results = Array.from({ length: 6 }, (_, i) =>
      result({
        url: `https://site${i}.example/${i}`,
        rank: i + 1,
        domain: `site${i}.example`,
        snippet: `Snippet ${i}`,
      }),
    );
    const fetchPage = vi.fn(async (url: string) => {
      if (url.includes("site0")) {
        return {
          url,
          finalUrl: url,
          contentType: "text/html",
          body: "<p>Only first page worked</p>",
        };
      }
      throw new WebFetchError("timeout", "fetch_aborted_or_timed_out");
    });
    const out = await runWebSearchPipeline("current docs for API", {
      signal: AbortSignal.timeout(5_000),
      provider: mockProvider(results),
      config: { ...config, maxPages: 3, maxSources: 5 },
      fetchPage,
    });
    expect(out.degraded).toBe(true);
    expect(out.pagesFetched).toBe(1);
    expect(out.sources.length).toBeGreaterThanOrEqual(1);
    expect(out.sources.length).toBeLessThanOrEqual(5);
    expect(out.sources.some((s) => s.retrieval === "web_search")).toBe(true);
    expect(out.sources.some((s) => s.retrieval === "web_snippet_only")).toBe(true);
  });

  it("never throws when fetchPage throws unexpected errors", async () => {
    const results = [result({ url: "https://ok.example/", rank: 1, snippet: "fallback snippet" })];
    const out = await runWebSearchPipeline("news today", {
      signal: AbortSignal.timeout(5_000),
      provider: mockProvider(results),
      config: { ...config, maxPages: 2 },
      fetchPage: async () => {
        throw new Error("boom");
      },
    });
    expect(out.degraded).toBe(true);
    expect(out.sources[0]?.retrieval).toBe("web_snippet_only");
  });
});
