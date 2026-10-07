import type { WebContextInput, WebSearchResult } from "@/lib/web/types";

/** V1 bounds from the product brief. */
export const WEB_SEARCH_RESULT_MIN = 5;
export const WEB_SEARCH_RESULT_MAX = 8;
export const WEB_FETCH_PAGES_MIN = 2;
export const WEB_FETCH_PAGES_MAX = 4;
export const WEB_CONTEXT_SOURCES_MAX = 5;

export function clampSearchResultCount(requested: number): number {
  if (!Number.isFinite(requested)) return WEB_SEARCH_RESULT_MAX;
  return Math.min(WEB_SEARCH_RESULT_MAX, Math.max(WEB_SEARCH_RESULT_MIN, Math.trunc(requested)));
}

export function clampFetchPageCount(requested: number): number {
  if (!Number.isFinite(requested)) return WEB_FETCH_PAGES_MAX;
  return Math.min(WEB_FETCH_PAGES_MAX, Math.max(WEB_FETCH_PAGES_MIN, Math.trunc(requested)));
}

export function clampSourceCount(requested: number): number {
  if (!Number.isFinite(requested)) return WEB_CONTEXT_SOURCES_MAX;
  return Math.min(WEB_CONTEXT_SOURCES_MAX, Math.max(1, Math.trunc(requested)));
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/** Cap and order provider results (rank ascending). Dedupes by URL. */
export function selectSearchResults(
  results: WebSearchResult[],
  maxResults: number,
): WebSearchResult[] {
  const limit = clampSearchResultCount(maxResults);
  const seen = new Set<string>();
  const ordered = [...results].sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url));
  const selected: WebSearchResult[] = [];
  for (const result of ordered) {
    const key = normalizeUrlKey(result.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(result);
    if (selected.length >= limit) break;
  }
  return selected;
}

/** Choose which search hits to fetch (2–4). Prefers higher-ranked unique domains. */
export function selectUrlsToFetch(
  results: WebSearchResult[],
  maxPages: number,
): WebSearchResult[] {
  const limit = clampFetchPageCount(maxPages);
  const seenUrls = new Set<string>();
  const seenDomains = new Set<string>();
  const primary: WebSearchResult[] = [];
  const secondary: WebSearchResult[] = [];

  for (const result of results) {
    const key = normalizeUrlKey(result.url);
    if (!key || seenUrls.has(key)) continue;
    seenUrls.add(key);
    const domain = result.domain.toLowerCase();
    if (!seenDomains.has(domain)) {
      seenDomains.add(domain);
      primary.push(result);
    } else {
      secondary.push(result);
    }
  }

  return [...primary, ...secondary].slice(0, limit);
}

/** Final web sources to the model — hard cap ≤5. */
export function selectFinalSources(
  sources: WebContextInput[],
  maxSources: number,
): WebContextInput[] {
  const limit = clampSourceCount(Math.min(WEB_CONTEXT_SOURCES_MAX, maxSources));
  const seen = new Set<string>();
  const selected: WebContextInput[] = [];
  for (const source of sources) {
    const key = normalizeUrlKey(source.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(source);
    if (selected.length >= limit) break;
  }
  return selected;
}
