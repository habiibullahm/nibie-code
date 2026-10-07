import "server-only";

import type { WebSearchConfig } from "@/lib/web/config";
import {
  classifyFetchFailure,
  classifySearchFailure,
  emptyDegradedResult,
  sourcesFromSnippets,
  type WebPipelineResult,
} from "@/lib/web/degrade";
import { extractReadableText } from "@/lib/web/extract";
import { fetchWebPage, WebFetchError } from "@/lib/web/fetch-page";
import type { WebSearchProvider } from "@/lib/web/provider";
import {
  clampFetchPageCount,
  clampSearchResultCount,
  clampSourceCount,
  selectFinalSources,
  selectSearchResults,
  selectUrlsToFetch,
} from "@/lib/web/select";
import type { WebContextInput, WebSearchResult } from "@/lib/web/types";

export type { WebPipelineResult } from "@/lib/web/degrade";
export type { WebSearchConfig } from "@/lib/web/config";
export type { WebSearchProvider } from "@/lib/web/provider";

export type RunWebSearchPipelineOptions = {
  signal: AbortSignal;
  provider: WebSearchProvider | null;
  config: WebSearchConfig | null;
  /** Test seam — override page fetch. */
  fetchPage?: typeof fetchWebPage;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
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
 * Search → select → SSRF-safe fetch → extract → bounded WebContextInput[].
 * Never throws: provider/fetch failures degrade to snippets or empty + category.
 */
export async function runWebSearchPipeline(
  query: string,
  opts: RunWebSearchPipelineOptions,
): Promise<WebPipelineResult> {
  const { provider, config, signal } = opts;
  if (!provider || !config) {
    return emptyDegradedResult("provider_unconfigured");
  }
  if (!query.trim()) {
    return emptyDegradedResult("empty");
  }

  const maxResults = clampSearchResultCount(config.maxResults);
  const maxPages = clampFetchPageCount(config.maxPages);
  const maxSources = clampSourceCount(config.maxSources);
  const fetchPage = opts.fetchPage ?? fetchWebPage;

  let rawResults: WebSearchResult[];
  try {
    rawResults = await provider.searchWeb(query.trim(), { maxResults, signal });
  } catch (error) {
    return emptyDegradedResult(classifySearchFailure(error));
  }

  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    return emptyDegradedResult("empty");
  }

  const selected = selectSearchResults(rawResults, maxResults);
  const toFetch = selectUrlsToFetch(selected, maxPages);

  const outcomes = await mapWithConcurrency(toFetch, maxPages, async (result): Promise<FetchOutcome> => {
    try {
      const page = await fetchPage(result.url, { signal });
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

  const fetchedSources: WebContextInput[] = [];
  const failedResults: WebSearchResult[] = [];
  let lastFailureCategory: string | undefined;
  let pagesFetched = 0;

  for (const outcome of outcomes) {
    if (outcome.ok) {
      if (outcome.source.retrieval === "web_search") pagesFetched += 1;
      fetchedSources.push(outcome.source);
    } else {
      failedResults.push(outcome.result);
      lastFailureCategory = outcome.category;
    }
  }

  // Prefer successful page extracts; fill remaining slots from snippets of failed fetches.
  const combined: WebContextInput[] = [...fetchedSources];
  if (combined.length < maxSources && failedResults.length) {
    const snippetFill = sourcesFromSnippets(failedResults, maxSources - combined.length);
    combined.push(...snippetFill);
  }

  // If nothing fetched but search had snippets, degrade to snippet-only.
  if (combined.length === 0) {
    const snippets = sourcesFromSnippets(selected, maxSources);
    if (snippets.length) {
      return {
        sources: selectFinalSources(snippets, maxSources),
        degraded: true,
        failureCategory: lastFailureCategory ?? "parse_error",
        searchResultCount: selected.length,
        pagesFetched: 0,
      };
    }
    return {
      sources: [],
      degraded: true,
      failureCategory: lastFailureCategory ?? "empty",
      searchResultCount: selected.length,
      pagesFetched: 0,
    };
  }

  const sources = selectFinalSources(combined, maxSources);
  const degraded =
    pagesFetched < toFetch.length ||
    sources.some((s) => s.retrieval === "web_snippet_only");

  return {
    sources,
    degraded,
    failureCategory: degraded ? lastFailureCategory : undefined,
    searchResultCount: selected.length,
    pagesFetched,
  };
}
