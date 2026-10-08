import "server-only";

import { githubGetJson, type GitHubRequestOptions } from "@/lib/github/client";
import { getGitHubConfig, type GitHubConfig } from "@/lib/github/config";
import { GitHubApiError } from "@/lib/github/errors";
import { normalizeRepo } from "@/lib/github/normalize";
import type { GitHubRateLimitInfo, GitHubRepoSummary } from "@/lib/github/types";

export type PublicRepoGateResult = {
  repo: GitHubRepoSummary;
  rateLimit: GitHubRateLimitInfo;
};

/**
 * V1 hard gate: only public repositories may be read.
 * Call before any nested repo resource (commits, PRs, issues, workflows).
 * Shared server tokens must never surface private repo data.
 */
export async function assertPublicRepository(
  owner: string,
  repo: string,
  opts: {
    signal: AbortSignal;
    config?: GitHubConfig;
    fetchImpl?: typeof fetch;
  },
): Promise<PublicRepoGateResult> {
  const config = opts.config ?? getGitHubConfig();
  const response = await githubGetJson<unknown>({
    path: `/repos/${owner}/${repo}`,
    signal: opts.signal,
    config,
    fetchImpl: opts.fetchImpl,
  });
  const summary = normalizeRepo(response.data);
  if (!summary) {
    throw new GitHubApiError("parse_error", "GitHub returned an unexpected repository payload.");
  }
  if (summary.private) {
    throw new GitHubApiError(
      "private_repo",
      "That GitHub repository is private. Nibie only reads public repositories in V1.",
      { status: 403 },
    );
  }
  return { repo: summary, rateLimit: response.rateLimit };
}

/** Convenience: public-gated GET under /repos/{owner}/{repo}/… */
export async function githubGetPublicRepoJson<T>(
  owner: string,
  repo: string,
  opts: Omit<GitHubRequestOptions, "path"> & { pathSuffix: string },
): Promise<{ data: T; rateLimit: GitHubRateLimitInfo; repo: GitHubRepoSummary }> {
  const gate = await assertPublicRepository(owner, repo, opts);
  const suffix = opts.pathSuffix.startsWith("/") ? opts.pathSuffix : `/${opts.pathSuffix}`;
  if (suffix === "/" || suffix === "") {
    return { data: undefined as T, rateLimit: gate.rateLimit, repo: gate.repo };
  }
  const response = await githubGetJson<T>({
    path: `/repos/${owner}/${repo}${suffix}`,
    query: opts.query,
    signal: opts.signal,
    config: opts.config,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  });
  return { data: response.data, rateLimit: response.rateLimit, repo: gate.repo };
}
