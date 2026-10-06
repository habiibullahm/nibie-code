import "server-only";

export type WebSearchConfig = {
  providerId: "tavily";
  apiKey: string;
  maxResults: number;
  maxPages: number;
  maxSources: number;
};

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MAX_PAGES = 4;
const DEFAULT_MAX_SOURCES = 5;

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

function trimmed(value: string | undefined) {
  return value?.trim() || undefined;
}

/** Positive integer within [min, max]; otherwise fallback. */
function boundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

/**
 * Optional web-search config. Returns null when unset or invalid so chat can continue without web.
 * Never logs or returns secrets beyond the in-memory apiKey for the server adapter.
 */
export function getWebSearchConfig(env: Env = process.env): WebSearchConfig | null {
  const providerId = trimmed(env.WEB_SEARCH_PROVIDER)?.toLowerCase();
  const apiKey = trimmed(env.TAVILY_API_KEY);
  if (!providerId || !apiKey) return null;
  if (providerId !== "tavily") return null;

  return {
    providerId: "tavily",
    apiKey,
    maxResults: boundedInt(env.WEB_SEARCH_MAX_RESULTS, DEFAULT_MAX_RESULTS, 1, 20),
    maxPages: boundedInt(env.WEB_FETCH_MAX_PAGES, DEFAULT_MAX_PAGES, 1, 10),
    maxSources: boundedInt(env.WEB_CONTEXT_MAX_SOURCES, DEFAULT_MAX_SOURCES, 1, 10),
  };
}
