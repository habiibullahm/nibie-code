import "server-only";

import { getWebSearchConfig } from "@/lib/web/config";
import { tavilySearchWeb } from "@/lib/web/providers/tavily";
import type { WebSearchResult } from "@/lib/web/types";

export interface WebSearchProvider {
  readonly id: "tavily";
  searchWeb(query: string, opts: { maxResults: number; signal: AbortSignal }): Promise<WebSearchResult[]>;
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Returns a configured search provider, or null when web search is disabled / unconfigured.
 */
export function getWebSearchProvider(env: Env = process.env): WebSearchProvider | null {
  const config = getWebSearchConfig(env);
  if (!config) return null;

  const apiKey = config.apiKey;
  return {
    id: "tavily",
    searchWeb(query, opts) {
      return tavilySearchWeb(apiKey, query, opts);
    },
  };
}
