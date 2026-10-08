import "server-only";

import { z } from "zod";
import { GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID } from "@/lib/actions/ids";
import type { ActionDefinition, ActionResultItem } from "@/lib/actions/types";
import {
  githubFailed,
  githubReadJson,
  githubSuccess,
  type GitHubActionDeps,
} from "@/lib/actions/tools/github-shared";
import {
  getGitHubConfig,
  githubPerPageSchema,
  githubRepoRefSchema,
  githubShaOrRefSchema,
  normalizeWorkflowRun,
} from "@/lib/github/index";

export const githubWorkflowRunsListInputSchema = githubRepoRefSchema.extend({
  branch: githubShaOrRefSchema,
  status: z
    .enum([
      "completed",
      "action_required",
      "cancelled",
      "failure",
      "neutral",
      "skipped",
      "stale",
      "success",
      "timed_out",
      "in_progress",
      "queued",
      "requested",
      "waiting",
      "pending",
    ])
    .optional(),
  perPage: githubPerPageSchema(30, 10),
});

export type GitHubWorkflowRunsListInput = z.infer<typeof githubWorkflowRunsListInputSchema>;

type WorkflowRunsPayload = {
  workflow_runs?: unknown[];
  total_count?: number;
};

export function createGitHubWorkflowRunsListAction(
  deps: GitHubActionDeps = {},
): ActionDefinition<typeof githubWorkflowRunsListInputSchema> {
  return {
    id: GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
    title: "GitHub Workflow Runs",
    description: "List recent GitHub Actions workflow runs for a repository. Read-only.",
    capability: "read",
    requiresConfirmation: false,
    inputSchema: githubWorkflowRunsListInputSchema,
    async execute(ctx, input, signal) {
      if (signal.aborted || ctx.signal.aborted) {
        return {
          ok: false,
          items: [],
          summary: "GitHub request was cancelled.",
          errorCode: "aborted",
          errorMessage: "aborted",
        };
      }
      const config = deps.config ?? getGitHubConfig();
      const perPage = Math.min(input.perPage, config.maxPerPage);
      try {
        const { data, rateLimit } = await githubReadJson<WorkflowRunsPayload>({
          path: `/repos/${input.owner}/${input.repo}/actions/runs`,
          query: {
            per_page: perPage,
            ...(input.branch ? { branch: input.branch } : {}),
            ...(input.status ? { status: input.status } : {}),
          },
          signal,
          config,
          fetchImpl: deps.fetchImpl,
        });
        const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
        const items: ActionResultItem[] = runs
          .map(normalizeWorkflowRun)
          .filter((run): run is NonNullable<typeof run> => Boolean(run))
          .map((run) => ({
            title: run.displayTitle ?? run.name ?? `Run ${run.id}`,
            url: run.htmlUrl,
            snippet: [run.status, run.conclusion, run.headBranch, run.event]
              .filter(Boolean)
              .join(" · "),
            provenance: "github.workflow_run",
            data: {
              id: run.id,
              status: run.status,
              conclusion: run.conclusion,
              headBranch: run.headBranch,
              headSha: run.headSha,
              event: run.event,
              updatedAt: run.updatedAt,
            },
          }));
        return githubSuccess({
          items,
          summary:
            items.length === 0
              ? `No workflow runs found for ${input.owner}/${input.repo}.`
              : `Found ${items.length} workflow run${items.length === 1 ? "" : "s"} on ${input.owner}/${input.repo}.`,
          owner: input.owner,
          repo: input.repo,
          rateLimit,
          extraMeta: {
            branch: input.branch ?? null,
            status: input.status ?? null,
            totalCount: typeof data?.total_count === "number" ? data.total_count : null,
          },
        });
      } catch (error) {
        return githubFailed(error, "Could not list workflow runs for that repository.");
      }
    },
  };
}

export const githubWorkflowRunsListAction = createGitHubWorkflowRunsListAction();
