export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  rank: number;
  domain: string;
  publishedAt?: string | null;
};

export type WebContextInput = {
  url: string;
  title: string;
  domain: string;
  retrieval: "web_search" | "web_snippet_only";
  publishedAt?: string | null;
  text: string;
  /** Deterministic citation handle id (e.g. `web:1`) when Citations V1 prepared this source. */
  citationHandle?: string;
};

/** Stable route reasons for logs and tests. Search reasons first, then no-search. */
export type WebRouteReason =
  | "explicit_request"
  | "temporal_currency"
  | "news"
  | "prices_markets"
  | "schedules"
  | "releases_versions"
  | "public_figures"
  | "current_docs"
  | "jobs"
  | "public_info_stale"
  | "conceptual"
  | "pure_writing"
  | "generic_coding"
  | "room_sufficient"
  | "default_no_search";

export type WebRouteDecision = {
  search: boolean;
  reason: WebRouteReason;
};
