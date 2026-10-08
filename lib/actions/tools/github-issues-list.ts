import "server-only";

import { z } from "zod";
import { GITHUB_ISSUES_LIST_ACTION_ID } from "@/lib/actions/ids";
import type { ActionDefinition, ActionResultItem } from "@/lib/actions/types";
import {
  githubFailed,
  githubReadJson,
  githubSuccess,
  type GitHubActionDeps,
} from "@/lib/actions/tools/github-shared";
import {
  getGitHubConfig,
  githubIssueStateSchema,
  githubPerPageSchema,
  githubRepoRefSchema,
  normalizeIssue,
} from "@/lib/github/index";

export const githubIssuesListInputSchema = githubRepoRefSchema.extend({
  state: githubIssueStateSchema,
  perPage: githubPerPageSchema(30, 10),
});

export type GitHubIssuesListInput = z.infer<typeof githubIssuesListInputSchema>;

export function createGitHubIssuesListAction(
  deps: GitHubActionDeps = {},
): ActionDefinition<typeof githubIssuesListInputSchema> {
  return {
    id: GITHUB_ISSUES_LIST_ACTION_ID,
    title: "GitHub Issues",
    description: "List issues on a GitHub repository (pull requests excluded). Read-only.",
    capability: "read",
    requiresConfirmation: false,
    inputSchema: githubIssuesListInputSchema,
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
        // Request extra rows because the Issues API mixes PRs; we filter them out.
        const fetchCount = Math.min(perPage * 2, config.maxPerPage);
        const { data, rateLimit } = await githubReadJson<unknown[]>({
          path: `/repos/${input.owner}/${input.repo}/issues`,
          query: { state: input.state, per_page: fetchCount },
          signal,
          config,
          fetchImpl: deps.fetchImpl,
        });
        const items: ActionResultItem[] = (Array.isArray(data) ? data : [])
          .map(normalizeIssue)
          .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue))
          .slice(0, perPage)
          .map((issue) => ({
            title: `#${issue.number} ${issue.title}`,
            url: issue.htmlUrl,
            snippet: [issue.state, issue.authorLogin, issue.labels.slice(0, 5).join(", ") || null]
              .filter(Boolean)
              .join(" · "),
            provenance: "github.issue",
            data: {
              number: issue.number,
              state: issue.state,
              authorLogin: issue.authorLogin,
              labels: issue.labels,
              updatedAt: issue.updatedAt,
            },
          }));
        return githubSuccess({
          items,
          summary:
            items.length === 0
              ? `No ${input.state} issues for ${input.owner}/${input.repo}.`
              : `Found ${items.length} ${input.state} issue${items.length === 1 ? "" : "s"} on ${input.owner}/${input.repo}.`,
          owner: input.owner,
          repo: input.repo,
          rateLimit,
          extraMeta: { state: input.state },
        });
      } catch (error) {
        return githubFailed(error, "Could not list issues for that repository.");
      }
    },
  };
}

export const githubIssuesListAction = createGitHubIssuesListAction();
