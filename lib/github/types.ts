/** Normalized, audit-safe GitHub Read result shapes — no tokens, emails, or raw payloads. */

export type GitHubActor = {
  login: string;
  htmlUrl?: string;
};

export type GitHubRepoSummary = {
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  pushedAt: string | null;
  updatedAt: string | null;
};

export type GitHubCommitSummary = {
  sha: string;
  shortSha: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  committedAt: string | null;
  htmlUrl: string;
};

export type GitHubPullRequestSummary = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  htmlUrl: string;
  authorLogin: string | null;
  baseRef: string | null;
  headRef: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  bodyPreview: string | null;
};

export type GitHubIssueSummary = {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  authorLogin: string | null;
  labels: string[];
  createdAt: string | null;
  updatedAt: string | null;
  bodyPreview: string | null;
};

export type GitHubWorkflowRunSummary = {
  id: number;
  name: string | null;
  displayTitle: string | null;
  status: string | null;
  conclusion: string | null;
  event: string | null;
  headBranch: string | null;
  headSha: string | null;
  htmlUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GitHubRateLimitInfo = {
  remaining: number | null;
  limit: number | null;
  resetAt: string | null;
};
