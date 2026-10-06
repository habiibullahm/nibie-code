import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getWebSearchProvider } from "@/lib/web/provider";

const configured = {
  WEB_SEARCH_PROVIDER: "tavily",
  TAVILY_API_KEY: "tvly-test-secret",
};

function tavilyBody(results: unknown[]) {
  return JSON.stringify({ results });
}

describe("getWebSearchProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when web search is unconfigured", () => {
    expect(getWebSearchProvider({})).toBeNull();
    expect(getWebSearchProvider({ WEB_SEARCH_PROVIDER: "tavily" })).toBeNull();
  });

  it("returns a tavily provider that posts to the Search API with Bearer auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        tavilyBody([
          {
            title: "Example Title",
            url: "https://www.example.com/page",
            content: "A relevant snippet.",
            published_date: "2026-01-15",
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = getWebSearchProvider(configured);
    expect(provider?.id).toBe("tavily");
    const signal = AbortSignal.timeout(5_000);
    const results = await provider!.searchWeb("latest example news", { maxResults: 5, signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect(init.signal).toBe(signal);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tvly-test-secret");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      query: "latest example news",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    });
    expect(results).toEqual([
      {
        title: "Example Title",
        url: "https://www.example.com/page",
        snippet: "A relevant snippet.",
        rank: 1,
        domain: "www.example.com",
        publishedAt: "2026-01-15",
      },
    ]);
  });

  it("skips malformed rows and caps at maxResults", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          tavilyBody([
            { title: "Good", url: "https://a.example/1", content: "one" },
            { title: "", url: "https://a.example/2", content: "bad title" },
            { title: "No url", url: "not a url", content: "bad" },
            { title: "Two", url: "https://b.example/2", content: "two" },
            { title: "Three", url: "https://c.example/3", content: "three" },
          ]),
          { status: 200 },
        ),
      ),
    );

    const provider = getWebSearchProvider(configured)!;
    const results = await provider.searchWeb("q", { maxResults: 2, signal: new AbortController().signal });
    expect(results).toEqual([
      { title: "Good", url: "https://a.example/1", snippet: "one", rank: 1, domain: "a.example", publishedAt: null },
      { title: "Two", url: "https://b.example/2", snippet: "two", rank: 2, domain: "b.example", publishedAt: null },
    ]);
  });

  it("returns empty results for blank queries without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = getWebSearchProvider(configured)!;
    expect(await provider.searchWeb("   ", { maxResults: 8, signal: new AbortController().signal })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides provider HTTP failures behind a generic error and never surfaces the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    const provider = getWebSearchProvider(configured)!;
    await expect(provider.searchWeb("q", { maxResults: 3, signal: new AbortController().signal })).rejects.toThrow(
      "Web search provider request failed.",
    );

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket detail with tvly-test-secret"); }));
    const err = await provider.searchWeb("q", { maxResults: 3, signal: new AbortController().signal }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Web search provider request failed.");
    expect((err as Error).message).not.toContain("tvly-test-secret");
  });

  it("rethrows when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); }));
    const provider = getWebSearchProvider(configured)!;
    await expect(provider.searchWeb("q", { maxResults: 3, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
