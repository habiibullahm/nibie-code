import "server-only";

export type GitHubConfig = {
  /** Optional PAT / App token for higher rate limits. Never log or persist. */
  token: string | null;
  apiBaseUrl: string;
  /** Per-request wall-clock timeout (ms). */
  timeoutMs: number;
  /** Default page size for list Actions. */
  defaultPerPage: number;
  /** Hard cap on per_page for list Actions. */
  maxPerPage: number;
  userAgent: string;
  apiVersion: string;
};

const DEFAULT_API_BASE = "https://api.github.com";
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

/**
 * Server-only GitHub Read config. Token is optional — public repos work unauthenticated
 * with lower rate limits. Returns a config always (never null) so Actions can degrade
 * honestly when GitHub is unreachable.
 */
export function getGitHubConfig(env: Env = process.env): GitHubConfig {
  const base = trimmed(env.GITHUB_API_BASE_URL) ?? DEFAULT_API_BASE;
  // Only allow https://api.github.com or explicitly configured HTTPS base (tests).
  const apiBaseUrl = base.replace(/\/+$/, "");
  return {
    token: trimmed(env.GITHUB_TOKEN) ?? null,
    apiBaseUrl,
    timeoutMs: boundedInt(env.GITHUB_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 2_000, 45_000),
    defaultPerPage: DEFAULT_PER_PAGE,
    maxPerPage: MAX_PER_PAGE,
    userAgent: "NibieBot/1.0 (+https://nibie.app; github-read)",
    apiVersion: "2022-11-28",
  };
}
