import { classifyFetchFailure, classifySearchFailure } from "@/lib/web/degrade";
import { extractReadableText } from "@/lib/web/extract";
import { fetchWebPage, WebFetchError } from "@/lib/web/fetch-page";
import type { WebSearchProvider } from "@/lib/web/provider";
import type { WebContextInput, WebSearchResult } from "@/lib/web/types";
import {
  RESEARCH_RESULTS_PER_QUERY,
} from "@/lib/research/budgets";
import {
  mergeResearchCandidates,
  selectResearchFinalSources,
  selectResearchQueryResults,
  selectResearchUrlsToFetch,
} from "@/lib/research/select";

export type ResearchGatherOptions = {
  signal: AbortSignal;
  provider: WebSearchProvider;
  fetchPage?: typeof fetchWebPage;
  resultsPerQuery?: number;
};

export type ResearchGatherResult = {
  sources: WebContextInput[];
  searchQueryCount: number;
  searchResultCount: number;
  candidateUrlCount: number;
  pagesFetched: number;
  pagesFailed: number;
  failureCategory?: string;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

type FetchOutcome =
  | { ok: true; source: WebContextInput }
  | { ok: false; category: string; result: WebSearchResult };

/**
 * Multi-query search → candidate merge → SSRF-safe fetch → bounded sources.
 * Skips bad sources; never throws for per-page failures. Uses existing fetchWebPage only.
 */
export async function gatherResearchSources(
  queries: readonly string[],
  opts: ResearchGatherOptions,
): Promise<ResearchGatherResult> {
  const provider = opts.provider;
  const fetchPage = opts.fetchPage ?? fetchWebPage;
  const resultsPerQuery = opts.resultsPerQuery ?? RESEARCH_RESULTS_PER_QUERY;
  const perQuery: WebSearchResult[][] = [];
  let searchResultCount = 0;
  let lastSearchFailure: string | undefined;
  let searchQueryCount = 0;

  for (const query of queries) {
    if (opts.signal.aborted) break;
    const trimmed = query.trim();
    if (!trimmed) continue;
    searchQueryCount += 1;
    try {
      const raw = await provider.searchWeb(trimmed, { maxResults: resultsPerQuery, signal: opts.signal });
      const selected = selectResearchQueryResults(Array.isArray(raw) ? raw : [], resultsPerQuery);
      perQuery.push(selected);
      searchResultCount += selected.length;
    } catch (error) {
      lastSearchFailure = classifySearchFailure(error);
      perQuery.push([]);
    }
  }

  const candidates = mergeResearchCandidates(perQuery);
  const toFetch = selectResearchUrlsToFetch(candidates);

  const outcomes = await mapWithConcurrency(toFetch, Math.min(4, toFetch.length || 1), async (result): Promise<FetchOutcome> => {
    if (opts.signal.aborted) {
      return { ok: false, category: "timeout", result };
    }
    try {
      const page = await fetchPage(result.url, { signal: opts.signal });
      const text = extractReadableText(page.body);
      if (!text) {
        const snippet = result.snippet.trim();
        if (snippet) {
          return {
            ok: true,
            source: {
              url: result.url,
              title: result.title || page.finalUrl,
              domain: result.domain,
              retrieval: "web_snippet_only",
              publishedAt: result.publishedAt ?? null,
              text: snippet,
            },
          };
        }
        return { ok: false, category: "parse_error", result };
      }
      return {
        ok: true,
        source: {
          url: result.url,
          title: result.title || page.finalUrl,
          domain: result.domain,
          retrieval: "web_search",
          publishedAt: result.publishedAt ?? null,
          text,
        },
      };
    } catch (error) {
      const category =
        error instanceof WebFetchError ? error.category : classifyFetchFailure(error);
      return { ok: false, category, result };
    }
  });

  const fetched: WebContextInput[] = [];
  let pagesFetched = 0;
  let pagesFailed = 0;
  let lastFetchFailure: string | undefined;

  for (const outcome of outcomes) {
    if (outcome.ok) {
      if (outcome.source.retrieval === "web_search") pagesFetched += 1;
      fetched.push(outcome.source);
    } else {
      pagesFailed += 1;
      lastFetchFailure = outcome.category;
    }
  }

  // Snippet fill from candidates not successfully fetched as full pages.
  if (fetched.length < 10) {
    const fetchedKeys = new Set(fetched.map((s) => s.url));
    for (const result of candidates) {
      if (fetched.length >= 10) break;
      if (fetchedKeys.has(result.url)) continue;
      const snippet = result.snippet.trim();
      if (!snippet) continue;
      fetched.push({
        url: result.url,
        title: result.title,
        domain: result.domain,
        retrieval: "web_snippet_only",
        publishedAt: result.publishedAt ?? null,
        text: snippet,
      });
      fetchedKeys.add(result.url);
    }
  }

  const sources = selectResearchFinalSources(fetched);
  return {
    sources,
    searchQueryCount,
    searchResultCount,
    candidateUrlCount: candidates.length,
    pagesFetched,
    pagesFailed,
    failureCategory: sources.length ? lastFetchFailure : (lastSearchFailure ?? lastFetchFailure ?? "empty"),
  };
}
