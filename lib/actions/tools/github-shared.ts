import "server-only";

import type { ActionErrorCode, ActionResult, ActionResultItem } from "@/lib/actions/types";
import {
  GitHubApiError,
  actionErrorCodeForGitHub,
  getGitHubConfig,
  githubGetJson,
  userFacingGitHubError,
  type GitHubConfig,
  type GitHubRateLimitInfo,
} from "@/lib/github/index";

export type GitHubActionMeta = {
  owner: string;
  repo: string;
  itemCount: number;
  rateLimit?: GitHubRateLimitInfo;
  failureCategory?: string;
};

export function githubFailed(
  error: unknown,
  fallback: string,
): ActionResult {
  if (error instanceof GitHubApiError) {
    const code: ActionErrorCode = actionErrorCodeForGitHub(error.category);
    return {
      ok: false,
      items: [],
      summary: userFacingGitHubError(error),
      errorCode: code,
      errorMessage: error.category,
      metadata: {
        failureCategory: error.category,
        ...(error.status != null ? { status: error.status } : {}),
        ...(error.retryAfterSeconds != null
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    };
  }
  if (error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message))) {
    return {
      ok: false,
      items: [],
      summary: "GitHub request was cancelled.",
      errorCode: "aborted",
      errorMessage: "aborted",
    };
  }
  return {
    ok: false,
    items: [],
    summary: fallback,
    errorCode: "execution_failed",
    errorMessage: "execution_failed",
  };
}

export async function githubReadJson<T>(args: {
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal: AbortSignal;
  config?: GitHubConfig;
  fetchImpl?: typeof fetch;
}): Promise<{ data: T; rateLimit: GitHubRateLimitInfo }> {
  const config = args.config ?? getGitHubConfig();
  const response = await githubGetJson<T>({
    path: args.path,
    query: args.query,
    signal: args.signal,
    config,
    fetchImpl: args.fetchImpl,
  });
  return { data: response.data, rateLimit: response.rateLimit };
}

export function githubSuccess(args: {
  items: ActionResultItem[];
  summary: string;
  owner: string;
  repo: string;
  rateLimit?: GitHubRateLimitInfo;
  extraMeta?: Record<string, unknown>;
}): ActionResult {
  return {
    ok: true,
    items: args.items,
    summary: args.summary,
    metadata: {
      owner: args.owner,
      repo: args.repo,
      itemCount: args.items.length,
      ...(args.rateLimit ? { rateLimit: args.rateLimit } : {}),
      ...(args.extraMeta ?? {}),
    } satisfies GitHubActionMeta & Record<string, unknown>,
  };
}

/** Test seam: inject fetch for unit tests without touching global fetch. */
export type GitHubActionDeps = {
  fetchImpl?: typeof fetch;
  config?: GitHubConfig;
};
