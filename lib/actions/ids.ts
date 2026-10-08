/** Stable Action ids — safe for client and server (no secrets). */
export const WEB_SEARCH_ACTION_ID = "web.search" as const;

export const GITHUB_REPO_GET_ACTION_ID = "github.repo.get" as const;
export const GITHUB_COMMITS_LIST_ACTION_ID = "github.commits.list" as const;
export const GITHUB_PULL_REQUEST_GET_ACTION_ID = "github.pull_request.get" as const;
export const GITHUB_PULL_REQUESTS_LIST_ACTION_ID = "github.pull_requests.list" as const;
export const GITHUB_ISSUES_LIST_ACTION_ID = "github.issues.list" as const;
export const GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID = "github.workflow_runs.list" as const;

/** All GitHub Read Action ids registered in Phase A. */
export const GITHUB_READ_ACTION_IDS = [
  GITHUB_REPO_GET_ACTION_ID,
  GITHUB_COMMITS_LIST_ACTION_ID,
  GITHUB_PULL_REQUEST_GET_ACTION_ID,
  GITHUB_PULL_REQUESTS_LIST_ACTION_ID,
  GITHUB_ISSUES_LIST_ACTION_ID,
  GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
] as const;

export type GitHubReadActionId = (typeof GITHUB_READ_ACTION_IDS)[number];
