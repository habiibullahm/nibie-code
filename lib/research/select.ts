import {
  RESEARCH_CANDIDATE_URLS_MAX,
  RESEARCH_FETCH_PAGES_MAX,
  RESEARCH_FINAL_CITED_MAX,
  RESEARCH_MAX_PAGES_PER_DOMAIN,
  RESEARCH_RESULTS_PER_QUERY,
} from "@/lib/research/budgets";
import type { WebContextInput, WebSearchResult } from "@/lib/web/types";

export function normalizeResearchUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    // Drop trailing slash on path-only roots for stable dedupe.
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/** Cap provider hits for one query; dedupe by canonical URL. */
export function selectResearchQueryResults(
  results: WebSearchResult[],
  maxResults: number = RESEARCH_RESULTS_PER_QUERY,
): WebSearchResult[] {
  const limit = Math.min(RESEARCH_RESULTS_PER_QUERY, Math.max(1, Math.trunc(maxResults)));
  const seen = new Set<string>();
  const ordered = [...results].sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url));
  const selected: WebSearchResult[] = [];
  for (const result of ordered) {
    const key = normalizeResearchUrlKey(result.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(result);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Merge query result lists into a global candidate pool (≤30).
 * Prefer unique domains; avoid same-domain spam; keep rank order within query.
 */
export function mergeResearchCandidates(
  perQuery: readonly WebSearchResult[][],
  maxCandidates: number = RESEARCH_CANDIDATE_URLS_MAX,
): WebSearchResult[] {
  const limit = Math.min(RESEARCH_CANDIDATE_URLS_MAX, Math.max(1, Math.trunc(maxCandidates)));
  const seenUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const primary: WebSearchResult[] = [];
  const secondary: WebSearchResult[] = [];

  for (const batch of perQuery) {
    for (const result of batch) {
      const key = normalizeResearchUrlKey(result.url);
      if (!key || seenUrls.has(key)) continue;
      seenUrls.add(key);
      const domain = result.domain.toLowerCase();
      const count = domainCounts.get(domain) ?? 0;
      if (count < 1) {
        domainCounts.set(domain, 1);
        primary.push(result);
      } else {
        domainCounts.set(domain, count + 1);
        secondary.push(result);
      }
    }
  }

  return [...primary, ...secondary].slice(0, limit);
}

/** Choose URLs to fetch (≤12) with domain diversity. */
export function selectResearchUrlsToFetch(
  candidates: WebSearchResult[],
  maxPages: number = RESEARCH_FETCH_PAGES_MAX,
): WebSearchResult[] {
  const limit = Math.min(RESEARCH_FETCH_PAGES_MAX, Math.max(1, Math.trunc(maxPages)));
  const seenUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const selected: WebSearchResult[] = [];

  const tryAdd = (result: WebSearchResult, allowRepeatDomain: boolean) => {
    if (selected.length >= limit) return;
    const key = normalizeResearchUrlKey(result.url);
    if (!key || seenUrls.has(key)) return;
    const domain = result.domain.toLowerCase();
    const count = domainCounts.get(domain) ?? 0;
    if (!allowRepeatDomain && count >= 1) return;
    if (count >= RESEARCH_MAX_PAGES_PER_DOMAIN) return;
    seenUrls.add(key);
    domainCounts.set(domain, count + 1);
    selected.push(result);
  };

  for (const result of candidates) tryAdd(result, false);
  for (const result of candidates) tryAdd(result, true);
  return selected;
}

/** Final cited sources ≤10; canonical URL dedupe; prefer fetched pages over snippets. */
export function selectResearchFinalSources(
  sources: WebContextInput[],
  maxSources: number = RESEARCH_FINAL_CITED_MAX,
): WebContextInput[] {
  const limit = Math.min(RESEARCH_FINAL_CITED_MAX, Math.max(1, Math.trunc(maxSources)));
  const ranked = [...sources].sort((a, b) => {
    const aFetched = a.retrieval === "web_search" ? 0 : 1;
    const bFetched = b.retrieval === "web_search" ? 0 : 1;
    if (aFetched !== bFetched) return aFetched - bFetched;
    return a.url.localeCompare(b.url);
  });
  const seen = new Set<string>();
  const domainCounts = new Map<string, number>();
  const selected: WebContextInput[] = [];
  for (const source of ranked) {
    const key = normalizeResearchUrlKey(source.url);
    if (!key || seen.has(key)) continue;
    const domain = source.domain.toLowerCase();
    const count = domainCounts.get(domain) ?? 0;
    if (count >= RESEARCH_MAX_PAGES_PER_DOMAIN && selected.length + 1 < limit) {
      // Skip domain spam unless we still need slots later — prefer diversity first.
      continue;
    }
    seen.add(key);
    domainCounts.set(domain, count + 1);
    selected.push(source);
    if (selected.length >= limit) break;
  }
  // Fill remaining if diversity filter left slots empty.
  if (selected.length < limit) {
    for (const source of ranked) {
      const key = normalizeResearchUrlKey(source.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      selected.push(source);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}
