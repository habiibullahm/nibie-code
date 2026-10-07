import { describe, expect, it, vi } from "vitest";
import { runDeepResearch } from "@/lib/research/orchestrator";
import type { ChatProvider } from "@/lib/ai/provider";
import type { WebSearchProvider } from "@/lib/web/provider";
import { MOCK_RESEARCH_PAGES } from "../fixtures/deep-research";

function sseBody(text: string): ReadableStream<Uint8Array> {
  const payload = JSON.stringify({ choices: [{ delta: { content: text } }] });
  const done = JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] });
  const raw = `data: ${payload}\n\ndata: ${done}\n\ndata: [DONE]\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(raw));
      controller.close();
    },
  });
}

describe("deep research orchestrator", () => {
  it("gathers multi-source evidence with one optional follow-up and emits progress stages", async () => {
    const stages: string[] = [];
    const planJson = JSON.stringify({
      normalizedQuestion: "Compare PostgreSQL and MySQL JSON",
      subquestions: ["postgres json", "mysql json", "tradeoffs"],
      initialQueries: ["postgresql jsonb", "mysql json type"],
      timeSensitive: false,
      notes: "",
    });

    const chatProvider: ChatProvider = {
      stream: vi.fn(async () => sseBody(planJson)),
    };

    const searchProvider: WebSearchProvider = {
      id: "tavily",
      searchWeb: vi.fn(async (query) => {
        if (query.includes("postgresql")) {
          return [{
            title: MOCK_RESEARCH_PAGES.postgresDocs.title,
            url: MOCK_RESEARCH_PAGES.postgresDocs.url,
            snippet: "jsonb",
            rank: 1,
            domain: MOCK_RESEARCH_PAGES.postgresDocs.domain,
          }];
        }
        return [{
          title: MOCK_RESEARCH_PAGES.mysqlDocs.title,
          url: MOCK_RESEARCH_PAGES.mysqlDocs.url,
          snippet: "json",
          rank: 1,
          domain: MOCK_RESEARCH_PAGES.mysqlDocs.domain,
        }];
      }),
    };

    const fetchPage = vi.fn(async (url: string) => {
      const page = Object.values(MOCK_RESEARCH_PAGES).find((p) => p.url === url) ?? MOCK_RESEARCH_PAGES.postgresDocs;
      return {
        finalUrl: page.url,
        contentType: "text/html",
        body: page.body,
      };
    });

    const result = await runDeepResearch({
      question: "Compare PostgreSQL and MySQL for JSON workloads",
      signal: new AbortController().signal,
      chatProvider,
      planMode: "Fast",
      searchProvider,
      fetchPage: fetchPage as never,
      onProgress: (stage) => stages.push(stage),
    });

    expect(stages[0]).toBe("planning");
    expect(stages).toContain("searching");
    expect(stages).toContain("reading");
    expect(stages).toContain("synthesizing");
    expect(result.web.length).toBeGreaterThanOrEqual(2);
    expect(result.metrics.searchQueryCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.pagesFetched).toBeGreaterThanOrEqual(1);
    expect(result.usagePolicy.id).toBe("temporary_undercount_v1");
    expect(result.status === "complete" || result.status === "incomplete").toBe(true);
  });

  it("continues when one fetch fails", async () => {
    const planJson = JSON.stringify({
      normalizedQuestion: "Node release",
      subquestions: ["version"],
      initialQueries: ["nodejs release"],
      timeSensitive: true,
    });
    const chatProvider: ChatProvider = { stream: vi.fn(async () => sseBody(planJson)) };
    const searchProvider: WebSearchProvider = {
      id: "tavily",
      searchWeb: vi.fn(async () => [
        {
          title: "bad",
          url: "https://bad.example/x",
          snippet: "nope",
          rank: 1,
          domain: "bad.example",
        },
        {
          title: MOCK_RESEARCH_PAGES.nodeDocs.title,
          url: MOCK_RESEARCH_PAGES.nodeDocs.url,
          snippet: "stable",
          rank: 2,
          domain: MOCK_RESEARCH_PAGES.nodeDocs.domain,
        },
      ]),
    };
    const fetchPage = vi.fn(async (url: string) => {
      if (url.includes("bad.example")) throw Object.assign(new Error("fail"), { category: "http_status" });
      return {
        finalUrl: MOCK_RESEARCH_PAGES.nodeDocs.url,
        contentType: "text/html",
        body: MOCK_RESEARCH_PAGES.nodeDocs.body,
      };
    });

    const result = await runDeepResearch({
      question: "What is the current stable Node.js version?",
      signal: new AbortController().signal,
      chatProvider,
      planMode: "Fast",
      searchProvider,
      fetchPage: fetchPage as never,
    });

    expect(result.metrics.pagesFailed).toBeGreaterThanOrEqual(1);
    expect(result.web.length).toBeGreaterThanOrEqual(1);
  });

  it("marks interrupted when aborted mid-run", async () => {
    const aborter = new AbortController();
    const chatProvider: ChatProvider = {
      stream: vi.fn(async () => {
        aborter.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    };
    const result = await runDeepResearch({
      question: "Research something",
      signal: aborter.signal,
      chatProvider,
      planMode: "Fast",
      searchProvider: { id: "tavily", searchWeb: vi.fn(async () => []) },
    });
    expect(result.status).toBe("interrupted");
  });

  it("marks gather deadline with evidence as incomplete (not interrupted/Stop)", async () => {
    const planJson = JSON.stringify({
      normalizedQuestion: "Slow gather",
      subquestions: ["a"],
      initialQueries: ["postgresql jsonb"],
      timeSensitive: false,
      notes: "",
    });
    const chatProvider: ChatProvider = {
      stream: vi.fn(async () => sseBody(planJson)),
    };
    const searchProvider: WebSearchProvider = {
      id: "tavily",
      searchWeb: vi.fn(async (_query, opts: { maxResults: number; signal: AbortSignal }) => {
        // Hold until gather deadline aborts, then return a hit; snippet fill keeps evidence after fetch abort.
        await new Promise<void>((resolve) => {
          if (opts.signal.aborted) resolve();
          else opts.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return [
          {
            title: MOCK_RESEARCH_PAGES.postgresDocs.title,
            url: MOCK_RESEARCH_PAGES.postgresDocs.url,
            snippet: "PostgreSQL jsonb evidence after deadline.",
            rank: 1,
            domain: MOCK_RESEARCH_PAGES.postgresDocs.domain,
          },
        ];
      }),
    };
    const fetchPage = vi.fn(async (_url: string, opts?: { signal?: AbortSignal }) => {
      if (opts?.signal?.aborted) throw Object.assign(new Error("aborted"), { category: "timeout" });
      return {
        finalUrl: MOCK_RESEARCH_PAGES.postgresDocs.url,
        contentType: "text/html",
        body: MOCK_RESEARCH_PAGES.postgresDocs.body,
      };
    });

    const result = await runDeepResearch({
      question: "Compare PostgreSQL JSON",
      signal: new AbortController().signal,
      chatProvider,
      planMode: "Fast",
      searchProvider,
      fetchPage: fetchPage as never,
      gatherDeadlineMs: 25,
    });

    expect(result.status).toBe("incomplete");
    expect(result.status).not.toBe("interrupted");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.metrics.incompleteReason).toBe("gather_deadline");
    expect(result.incompleteNotice).toMatch(/ran out of time/i);
  });

  it("fails transparently when search provider is missing", async () => {
    const result = await runDeepResearch({
      question: "Anything",
      signal: new AbortController().signal,
      chatProvider: { stream: vi.fn() },
      planMode: "Fast",
      searchProvider: null,
    });
    expect(result.status).toBe("failed");
    expect(result.incompleteNotice).toMatch(/not configured/i);
    expect(result.web).toHaveLength(0);
  });

  it("marks empty collection as failed (not incomplete) so synthesis must not run", async () => {
    const planJson = JSON.stringify({
      normalizedQuestion: "Obscure share",
      subquestions: ["share"],
      initialQueries: ["obscure saas market share"],
      timeSensitive: true,
    });
    const chatProvider: ChatProvider = { stream: vi.fn(async () => sseBody(planJson)) };
    const searchProvider: WebSearchProvider = {
      id: "tavily",
      searchWeb: vi.fn(async () => []),
    };
    const result = await runDeepResearch({
      question: "What is the exact market share of an obscure regional SaaS tool in 2026?",
      signal: new AbortController().signal,
      chatProvider,
      planMode: "Fast",
      searchProvider,
      fetchPage: vi.fn() as never,
    });
    expect(result.status).toBe("failed");
    expect(result.evidence).toHaveLength(0);
    expect(result.web).toHaveLength(0);
    expect(result.incompleteNotice).toMatch(/could not collect usable sources/i);
  });
});
