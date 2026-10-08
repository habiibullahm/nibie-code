import "server-only";

export type GitHubConfig = {
  /**
   * Optional PAT for higher public rate limits only.
   * Never used unless `GITHUB_READ_USE_TOKEN=true`. Private repos are always rejected.
   * Never log or persist.
   */
  token: string | null;
  /** Whether Authorization may be sent (still public-only). Default false. */
  useToken: boolean;
  apiBaseUrl: string;
  /** Per-request wall-clock timeout (ms). */
  timeoutMs: number;
  /** Default page size for list Actions. */
  defaultPerPage: number;
  /** Hard cap on per_page for list Actions. */
  maxPerPage: number;
  userAgent: string;
  apiVersion: string;
  /** V1 invariant — always true. */
  publicOnly: true;
};

const DEFAULT_API_BASE = "https://api.github.com";
const ALLOWED_API_HOSTS = new Set(["api.github.com"]);
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 30;

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function resolveApiBaseUrl(raw: string | undefined): string {
  const base = (raw ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return DEFAULT_API_BASE;
  }
  if (url.protocol !== "https:") return DEFAULT_API_BASE;
  if (!ALLOWED_API_HOSTS.has(url.hostname.toLowerCase())) return DEFAULT_API_BASE;
  if (url.pathname && url.pathname !== "/") return DEFAULT_API_BASE;
  return `${url.origin}`;
}

/**
 * Server-only GitHub Read config.
 * Dogfood defaults to unauthenticated public reads. Set `GITHUB_READ_USE_TOKEN=true`
 * with `GITHUB_TOKEN` only to raise public rate limits — private repos stay rejected.
 */
export function getGitHubConfig(env: Env = process.env): GitHubConfig {
  const token = trimmed(env.GITHUB_TOKEN) ?? null;
  const useToken = trimmed(env.GITHUB_READ_USE_TOKEN)?.toLowerCase() === "true" && Boolean(token);
  return {
    token: useToken ? token : null,
    useToken,
    apiBaseUrl: resolveApiBaseUrl(trimmed(env.GITHUB_API_BASE_URL)),
    timeoutMs: boundedInt(env.GITHUB_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 2_000, 45_000),
    defaultPerPage: DEFAULT_PER_PAGE,
    maxPerPage: MAX_PER_PAGE,
    userAgent: "NibieBot/1.0 (+https://nibie.app; github-read)",
    apiVersion: "2022-11-28",
    publicOnly: true,
  };
}

/** Test helper: build a config without reading process.env host rules twice. */
export function githubConfigForTests(
  overrides: Partial<Omit<GitHubConfig, "publicOnly">> = {},
): GitHubConfig {
  return {
    token: null,
    useToken: false,
    apiBaseUrl: DEFAULT_API_BASE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    defaultPerPage: DEFAULT_PER_PAGE,
    maxPerPage: MAX_PER_PAGE,
    userAgent: "NibieBot/1.0 (+https://nibie.app; github-read)",
    apiVersion: "2022-11-28",
    ...overrides,
    // Never allow turning publicOnly off.
    publicOnly: true,
  };
}
