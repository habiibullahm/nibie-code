import type { WebContextInput, WebSearchResult } from "@/lib/web/types";
import { clampSourceCount, WEB_CONTEXT_SOURCES_MAX } from "@/lib/web/select";

/** Observability / degrade categories used by the pipeline and route logs. */
export type WebFailureCategory =
  | "provider_unconfigured"
  | "provider_error"
  | "timeout"
  | "http_status"
  | "ssrf_blocked"
  | "content_type"
  | "size_limit"
  | "parse_error"
  | "empty";

export type WebPipelineResult = {
  sources: WebContextInput[];
  degraded: boolean;
  failureCategory?: string;
  searchResultCount: number;
  pagesFetched: number;
};

export function emptyDegradedResult(category: WebFailureCategory | string): WebPipelineResult {
  return {
    sources: [],
    degraded: true,
    failureCategory: category,
    searchResultCount: 0,
    pagesFetched: 0,
  };
}

/** Conservative snippet-only sources when page fetches fail. */
export function sourcesFromSnippets(
  results: WebSearchResult[],
  maxSources: number,
): WebContextInput[] {
  const limit = clampSourceCount(Math.min(WEB_CONTEXT_SOURCES_MAX, maxSources));
  const sources: WebContextInput[] = [];
  for (const result of results) {
    const text = result.snippet.trim();
    if (!text) continue;
    sources.push({
      url: result.url,
      title: result.title,
      domain: result.domain,
      retrieval: "web_snippet_only",
      publishedAt: result.publishedAt ?? null,
      text,
    });
    if (sources.length >= limit) break;
  }
  return sources;
}

export function classifySearchFailure(error: unknown): WebFailureCategory {
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    if (name === "aborterror" || message.includes("timeout") || message.includes("aborted")) {
      return "timeout";
    }
  }
  return "provider_error";
}

export function classifyFetchFailure(error: unknown): WebFailureCategory {
  if (error && typeof error === "object" && "category" in error) {
    const category = (error as { category: string }).category;
    if (
      category === "timeout" ||
      category === "http_status" ||
      category === "ssrf_blocked" ||
      category === "content_type" ||
      category === "size_limit" ||
      category === "parse_error"
    ) {
      return category;
    }
  }
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "parse_error";
}
