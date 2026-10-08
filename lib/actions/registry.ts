import "server-only";

import type { ActionDefinition } from "@/lib/actions/types";
import { githubCommitsListAction } from "@/lib/actions/tools/github-commits-list";
import { githubIssuesListAction } from "@/lib/actions/tools/github-issues-list";
import { githubPullRequestGetAction } from "@/lib/actions/tools/github-pull-request-get";
import { githubPullRequestsListAction } from "@/lib/actions/tools/github-pull-requests-list";
import { githubRepoGetAction } from "@/lib/actions/tools/github-repo-get";
import { githubWorkflowRunsListAction } from "@/lib/actions/tools/github-workflow-runs-list";
import { webSearchAction } from "@/lib/actions/tools/web-search";

/**
 * Central allowlist. Unknown IDs are rejected — never dynamically import from model text.
 * Register every Action explicitly here.
 *
 * V1 invariant (enforced in runtime via MAX_ACTIONS_PER_GENERATION): at most one
 * Action execution per generation — including GitHub Read Actions.
 */
const ACTIONS: readonly ActionDefinition[] = [
  webSearchAction,
  githubRepoGetAction,
  githubCommitsListAction,
  githubPullRequestGetAction,
  githubPullRequestsListAction,
  githubIssuesListAction,
  githubWorkflowRunsListAction,
];

const BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

export function listRegisteredActions(): readonly ActionDefinition[] {
  return ACTIONS;
}

export function getAction(actionId: string): ActionDefinition | undefined {
  return BY_ID.get(actionId);
}

export function isRegisteredAction(actionId: string): boolean {
  return BY_ID.has(actionId);
}

export function assertRegisteredAction(actionId: string): ActionDefinition {
  const action = BY_ID.get(actionId);
  if (!action) {
    throw new UnknownActionError(actionId);
  }
  return action;
}

/** All registered GitHub Read Actions are capability `read` (Phase A invariant). */
export function listGitHubReadActions(): readonly ActionDefinition[] {
  return ACTIONS.filter((action) => action.id.startsWith("github."));
}

export class UnknownActionError extends Error {
  readonly code = "unknown_action" as const;
  constructor(readonly actionId: string) {
    super(`Unknown Action: ${actionId}`);
    this.name = "UnknownActionError";
  }
}
