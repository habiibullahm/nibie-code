import "server-only";

import { getGitHubConfig, type GitHubConfig } from "@/lib/github/config";
import { GitHubApiError, type GitHubFailureCategory } from "@/lib/github/errors";
import { redactSecrets } from "@/lib/github/redact";
import type { GitHubRateLimitInfo } from "@/lib/github/types";

export type GitHubRequestOptions = {
  /** Path under api.github.com, e.g. `/repos/owner/repo`. Must start with `/`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal: AbortSignal;
  config?: GitHubConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type GitHubResponse<T> = {
  data: T;
  status: number;
  rateLimit: GitHubRateLimitInfo;
};

/** V1 hard rule: this client only performs GET. No mutation verbs. */
const ALLOWED_METHOD = "GET" as const;

function mergeSignals(user: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === "function") return AbortSignal.any([user, timeout]);
  return timeout;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  return undefined;
}

function rateLimitFromHeaders(headers: Headers): GitHubRateLimitInfo {
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const limitRaw = headers.get("x-ratelimit-limit");
  const resetRaw = headers.get("x-ratelimit-reset");
  const remaining = remainingRaw != null ? Number.parseInt(remainingRaw, 10) : null;
  const limit = limitRaw != null ? Number.parseInt(limitRaw, 10) : null;
  let resetAt: string | null = null;
  if (resetRaw) {
    const epoch = Number.parseInt(resetRaw, 10);
    if (Number.isFinite(epoch)) resetAt = new Date(epoch * 1000).toISOString();
  }
  return {
    remaining: Number.isFinite(remaining as number) ? remaining : null,
    limit: Number.isFinite(limit as number) ? limit : null,
    resetAt,
  };
}

function categoryForStatus(status: number): GitHubFailureCategory {
  if (status === 404) return "not_found";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status === 422) return "validation";
  return "http_status";
}

function buildUrl(config: GitHubConfig, path: string, query?: GitHubRequestOptions["query"]): URL {
  if (!path.startsWith("/")) {
    throw new GitHubApiError("validation", "GitHub path must be absolute under the API root.");
  }
  if (path.includes("..") || path.includes("//")) {
    throw new GitHubApiError("validation", "GitHub path is invalid.");
  }
  const url = new URL(`${config.apiBaseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * Bounded, read-only GitHub REST GET. Never logs Authorization or token values.
 * Throws GitHubApiError with an honest category on failure.
 */
export async function githubGetJson<T>(opts: GitHubRequestOptions): Promise<GitHubResponse<T>> {
  const config = opts.config ?? getGitHubConfig();
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = buildUrl(config, opts.path, opts.query);
  const combined = mergeSignals(opts.signal, timeoutMs);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": config.apiVersion,
    "User-Agent": config.userAgent,
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: ALLOWED_METHOD,
      headers,
      signal: combined,
      redirect: "manual",
    });
  } catch (error) {
    if (opts.signal.aborted) {
      throw new GitHubApiError("aborted", "GitHub request cancelled.", { cause: error });
    }
    if (combined.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new GitHubApiError("timeout", "GitHub request timed out.", { cause: error });
    }
    throw new GitHubApiError("network", "Could not reach GitHub.", { cause: error });
  }

  const rateLimit = rateLimitFromHeaders(response.headers);

  if (response.status === 403 || response.status === 429) {
    const remaining = rateLimit.remaining;
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    const bodyText = redactSecrets((await response.text().catch(() => "")).slice(0, 200));
    const rateLimited =
      response.status === 429 ||
      remaining === 0 ||
      /rate limit|secondary rate/i.test(bodyText);
    if (rateLimited) {
      throw new GitHubApiError("rate_limited", "GitHub rate limit reached.", {
        status: response.status,
        retryAfterSeconds: retryAfter,
      });
    }
  }

  if (!response.ok) {
    const category = categoryForStatus(response.status);
    // Drain body without retaining secrets.
    await response.text().catch(() => "");
    throw new GitHubApiError(category, `GitHub returned ${response.status}.`, {
      status: response.status,
    });
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch (error) {
    throw new GitHubApiError("parse_error", "GitHub returned non-JSON.", { cause: error });
  }

  return { data, status: response.status, rateLimit };
}
