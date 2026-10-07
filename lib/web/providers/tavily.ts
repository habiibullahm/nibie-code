import "server-only";

import type { WebSearchResult } from "@/lib/web/types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

type TavilyResultRow = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  published_date?: unknown;
};

type TavilySearchResponse = {
  results?: unknown;
};

function domainFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host || null;
  } catch {
    return null;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mapRow(row: TavilyResultRow, rank: number): WebSearchResult | null {
  const title = asNonEmptyString(row.title);
  const url = asNonEmptyString(row.url);
  if (!title || !url) return null;
  const domain = domainFromUrl(url);
  if (!domain) return null;
  const snippet = asNonEmptyString(row.content) ?? "";
  const publishedRaw = asNonEmptyString(row.published_date);
  return {
    title,
    url,
    snippet,
    rank,
    domain,
    publishedAt: publishedRaw ?? null,
  };
}

/**
 * Tavily Search adapter. Caller supplies AbortSignal; never logs the API key or response bodies.
 */
export async function tavilySearchWeb(
  apiKey: string,
  query: string,
  opts: { maxResults: number; signal: AbortSignal },
): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  let response: Response;
  try {
    response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      signal: opts.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: q,
        max_results: opts.maxResults,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
    });
  } catch (error) {
    if (opts.signal.aborted) throw error;
    throw new Error("Web search provider request failed.");
  }

  if (!response.ok) throw new Error("Web search provider request failed.");

  let body: TavilySearchResponse;
  try {
    body = (await response.json()) as TavilySearchResponse;
  } catch {
    throw new Error("Web search provider response invalid.");
  }

  if (!Array.isArray(body.results)) return [];

  const out: WebSearchResult[] = [];
  for (const raw of body.results) {
    if (!raw || typeof raw !== "object") continue;
    const mapped = mapRow(raw as TavilyResultRow, out.length + 1);
    if (mapped) out.push(mapped);
    if (out.length >= opts.maxResults) break;
  }
  return out;
}
