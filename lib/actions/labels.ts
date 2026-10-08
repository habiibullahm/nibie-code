import {
  GITHUB_COMMITS_LIST_ACTION_ID,
  GITHUB_ISSUES_LIST_ACTION_ID,
  GITHUB_PULL_REQUEST_GET_ACTION_ID,
  GITHUB_PULL_REQUESTS_LIST_ACTION_ID,
  GITHUB_REPO_GET_ACTION_ID,
  GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
  WEB_SEARCH_ACTION_ID,
} from "@/lib/actions/ids";
import type { ActionRunStatus } from "@/lib/actions/types";

/** Minimal user-facing Action status copy — no agent dashboard. */
export const ACTION_RUNNING_LABELS: Record<string, string> = {
  [WEB_SEARCH_ACTION_ID]: "Searching the web…",
  [GITHUB_REPO_GET_ACTION_ID]: "Checking GitHub…",
  [GITHUB_COMMITS_LIST_ACTION_ID]: "Checking GitHub…",
  [GITHUB_PULL_REQUEST_GET_ACTION_ID]: "Checking GitHub…",
  [GITHUB_PULL_REQUESTS_LIST_ACTION_ID]: "Checking GitHub…",
  [GITHUB_ISSUES_LIST_ACTION_ID]: "Checking GitHub…",
  [GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID]: "Checking GitHub…",
};

export const ACTION_USED_LABELS: Record<string, string> = {
  [WEB_SEARCH_ACTION_ID]: "Used Web Search",
  [GITHUB_REPO_GET_ACTION_ID]: "Used GitHub",
  [GITHUB_COMMITS_LIST_ACTION_ID]: "Used GitHub",
  [GITHUB_PULL_REQUEST_GET_ACTION_ID]: "Used GitHub",
  [GITHUB_PULL_REQUESTS_LIST_ACTION_ID]: "Used GitHub",
  [GITHUB_ISSUES_LIST_ACTION_ID]: "Used GitHub",
  [GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID]: "Used GitHub",
};

export function actionRunningLabel(actionId: string): string {
  return ACTION_RUNNING_LABELS[actionId] ?? "Running Action…";
}

export function actionUsedLabel(actionId: string): string {
  return ACTION_USED_LABELS[actionId] ?? "Used Action";
}

export function actionStatusLabel(actionId: string, status: ActionRunStatus): string | null {
  if (status === "running" || status === "requested") return actionRunningLabel(actionId);
  if (status === "completed") return actionUsedLabel(actionId);
  if (status === "cancelled") return "Action stopped";
  if (status === "failed") return null;
  if (status === "waiting_for_confirmation") return "Waiting for confirmation…";
  return null;
}
