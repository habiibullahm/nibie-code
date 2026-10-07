import { describe, expect, it } from "vitest";
import {
  isLikelyPrimarySource,
  mergeResearchCandidates,
  selectResearchFinalSources,
  selectResearchQueryResults,
  selectResearchUrlsToFetch,
} from "@/lib/research/select";
import {
  RESEARCH_CANDIDATE_URLS_MAX,
  RESEARCH_FETCH_PAGES_MAX,
  RESEARCH_FINAL_CITED_MAX,
} from "@/lib/research/budgets";
import type { WebContextInput, WebSearchResult } from "@/lib/web/types";

function hit(partial: Partial<WebSearchResult> & { url: string; domain: string }): WebSearchResult {
  return {
    title: partial.title ?? partial.domain,
    url: partial.url,
    snippet: partial.snippet ?? "snippet",
    rank: partial.rank ?? 1,
    domain: partial.domain,
    publishedAt: partial.publishedAt ?? null,
  };
}

describe("deep research select budgets", () => {
  it("caps per-query results and dedupes URLs", () => {
    const results = [
      hit({ url: "https://a.example/x", domain: "a.example", rank: 2 }),
      hit({ url: "https://a.example/x#frag", domain: "a.example", rank: 1 }),
      hit({ url: "https://b.example/y", domain: "b.example", rank: 3 }),
    ];
    const selected = selectResearchQueryResults(results, 5);
    expect(selected).toHaveLength(2);
    expect(selected[0]!.url).toContain("a.example");
  });

  it("merges candidates with domain diversity under global cap", () => {
    const batches = Array.from({ length: 8 }, (_, q) =>
      Array.from({ length: 5 }, (_, i) =>
        hit({
          url: `https://d${i}.example/q${q}`,
          domain: `d${i}.example`,
          rank: i + 1,
        }),
      ),
    );
    const merged = mergeResearchCandidates(batches);
    expect(merged.length).toBeLessThanOrEqual(RESEARCH_CANDIDATE_URLS_MAX);
    const domains = new Set(merged.map((r) => r.domain));
    expect(domains.size).toBeGreaterThan(3);
  });

  it("limits fetches and final cited sources", () => {
    const candidates = Array.from({ length: 40 }, (_, i) =>
      hit({ url: `https://site${i}.example/p`, domain: `site${i}.example`, rank: i }),
    );
    expect(selectResearchUrlsToFetch(candidates).length).toBeLessThanOrEqual(RESEARCH_FETCH_PAGES_MAX);
    const sources: WebContextInput[] = candidates.map((c) => ({
      url: c.url,
      title: c.title,
      domain: c.domain,
      retrieval: "web_search" as const,
      text: "body",
    }));
    expect(selectResearchFinalSources(sources).length).toBeLessThanOrEqual(RESEARCH_FINAL_CITED_MAX);
  });

  it("prefers fresher sources when time-sensitive", () => {
    const candidates = [
      hit({ url: "https://old.example/a", domain: "old.example", rank: 1, publishedAt: "2020-01-01" }),
      hit({ url: "https://new.example/a", domain: "new.example", rank: 2, publishedAt: "2026-06-01" }),
    ];
    const selected = selectResearchUrlsToFetch(candidates, 1, { timeSensitive: true });
    expect(selected[0]!.domain).toBe("new.example");
  });

  it("prefers official/docs primary sources when preferPrimary", () => {
    expect(isLikelyPrimarySource("https://docs.example.com/guide", "docs.example.com")).toBe(true);
    const candidates = [
      hit({ url: "https://blog.random.com/post", domain: "blog.random.com", rank: 1 }),
      hit({ url: "https://docs.example.com/guide", domain: "docs.example.com", rank: 2 }),
    ];
    const selected = selectResearchUrlsToFetch(candidates, 1, { preferPrimary: true });
    expect(selected[0]!.domain).toBe("docs.example.com");
  });
});
