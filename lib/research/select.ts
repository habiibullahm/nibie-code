import {
  RESEARCH_CANDIDATE_URLS_MAX,
  RESEARCH_FETCH_PAGES_MAX,
  RESEARCH_FINAL_CITED_MAX,
  RESEARCH_MAX_PAGES_PER_DOMAIN,
  RESEARCH_RESULTS_PER_QUERY,
} from "@/lib/research/budgets";
import type { WebContextInput, WebSearchResult } from "@/lib/web/types";

export type ResearchSelectOptions = {
  /** Prefer fresher publishedAt when the question is time-sensitive. */
  timeSensitive?: boolean;
  /** Prefer official/docs-like primary sources when the question asks for them. */
  preferPrimary?: boolean;
};

/** Lightweight primary-source heuristic (docs hosts, .gov/.edu, /docs paths). */
export function isLikelyPrimarySource(url: string, domain: string): boolean {
  const d = domain.toLowerCase();
  if (/\b(docs?|developer|developers|dev|help|support|learn|manual)\./i.test(d)) return true;
  if (d.endsWith(".gov") || d.endsWith(".edu") || d.endsWith(".gov.uk")) return true;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes("/docs") || path.includes("/documentation") || path.includes("/reference") || path.includes("/api/")) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function publishedAtMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function compareCandidates(a: WebSearchResult, b: WebSearchResult, opts: ResearchSelectOptions): number {
  if (opts.preferPrimary) {
    const ap = isLikelyPrimarySource(a.url, a.domain) ? 0 : 1;
    const bp = isLikelyPrimarySource(b.url, b.domain) ? 0 : 1;
    if (ap !== bp) return ap - bp;
  }
  if (opts.timeSensitive) {
    const af = publishedAtMs(a.publishedAt);
    const bf = publishedAtMs(b.publishedAt);
    if (af !== bf) return bf - af;
  }
  return a.rank - b.rank || a.url.localeCompare(b.url);
}

function compareSources(a: WebContextInput, b: WebContextInput, opts: ResearchSelectOptions): number {
  const aFetched = a.retrieval === "web_search" ? 0 : 1;
  const bFetched = b.retrieval === "web_search" ? 0 : 1;
  if (aFetched !== bFetched) return aFetched - bFetched;
  if (opts.preferPrimary) {
    const ap = isLikelyPrimarySource(a.url, a.domain) ? 0 : 1;
    const bp = isLikelyPrimarySource(b.url, b.domain) ? 0 : 1;
    if (ap !== bp) return ap - bp;
  }
  if (opts.timeSensitive) {
    const af = publishedAtMs(a.publishedAt);
    const bf = publishedAtMs(b.publishedAt);
    if (af !== bf) return bf - af;
  }
  return a.url.localeCompare(b.url);
}

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
 * Prefer unique domains; avoid same-domain spam; optionally prefer primary/fresher.
 */
export function mergeResearchCandidates(
  perQuery: readonly WebSearchResult[][],
  maxCandidates: number = RESEARCH_CANDIDATE_URLS_MAX,
  opts: ResearchSelectOptions = {},
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

  primary.sort((a, b) => compareCandidates(a, b, opts));
  secondary.sort((a, b) => compareCandidates(a, b, opts));
  return [...primary, ...secondary].slice(0, limit);
}

/** Choose URLs to fetch (≤12) with domain diversity; optional primary/freshness preference. */
export function selectResearchUrlsToFetch(
  candidates: WebSearchResult[],
  maxPages: number = RESEARCH_FETCH_PAGES_MAX,
  opts: ResearchSelectOptions = {},
): WebSearchResult[] {
  const limit = Math.min(RESEARCH_FETCH_PAGES_MAX, Math.max(1, Math.trunc(maxPages)));
  const ordered = [...candidates].sort((a, b) => compareCandidates(a, b, opts));
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

  for (const result of ordered) tryAdd(result, false);
  for (const result of ordered) tryAdd(result, true);
  return selected;
}

/** Final cited sources ≤10; canonical URL dedupe; prefer fetched / primary / fresher when opted. */
export function selectResearchFinalSources(
  sources: WebContextInput[],
  maxSources: number = RESEARCH_FINAL_CITED_MAX,
  opts: ResearchSelectOptions = {},
): WebContextInput[] {
  const limit = Math.min(RESEARCH_FINAL_CITED_MAX, Math.max(1, Math.trunc(maxSources)));
  const ranked = [...sources].sort((a, b) => compareSources(a, b, opts));
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
