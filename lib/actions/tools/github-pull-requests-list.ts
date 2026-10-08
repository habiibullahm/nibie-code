import "server-only";

import { z } from "zod";
import { GITHUB_PULL_REQUESTS_LIST_ACTION_ID } from "@/lib/actions/ids";
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
  githubPullStateSchema,
  githubRepoRefSchema,
  normalizePullRequest,
} from "@/lib/github/index";

export const githubPullRequestsListInputSchema = githubRepoRefSchema.extend({
  state: githubPullStateSchema,
  perPage: githubPerPageSchema(30, 10),
});

export type GitHubPullRequestsListInput = z.infer<typeof githubPullRequestsListInputSchema>;

export function createGitHubPullRequestsListAction(
  deps: GitHubActionDeps = {},
): ActionDefinition<typeof githubPullRequestsListInputSchema> {
  return {
    id: GITHUB_PULL_REQUESTS_LIST_ACTION_ID,
    title: "GitHub Pull Requests",
    description: "List pull requests on a GitHub repository. Read-only.",
    capability: "read",
    requiresConfirmation: false,
    inputSchema: githubPullRequestsListInputSchema,
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
        const { data, rateLimit } = await githubReadJson<unknown[]>({
          path: `/repos/${input.owner}/${input.repo}/pulls`,
          query: { state: input.state, per_page: perPage },
          signal,
          config,
          fetchImpl: deps.fetchImpl,
        });
        const items: ActionResultItem[] = (Array.isArray(data) ? data : [])
          .map(normalizePullRequest)
          .filter((pr): pr is NonNullable<typeof pr> => Boolean(pr))
          .map((pr) => ({
            title: `#${pr.number} ${pr.title}`,
            url: pr.htmlUrl,
            snippet: [pr.state, pr.draft ? "draft" : null, pr.authorLogin, pr.headRef && pr.baseRef ? `${pr.headRef} → ${pr.baseRef}` : null]
              .filter(Boolean)
              .join(" · "),
            provenance: "github.pull_request",
            data: {
              number: pr.number,
              state: pr.state,
              draft: pr.draft,
              authorLogin: pr.authorLogin,
              baseRef: pr.baseRef,
              headRef: pr.headRef,
              updatedAt: pr.updatedAt,
            },
          }));
        return githubSuccess({
          items,
          summary:
            items.length === 0
              ? `No ${input.state} pull requests for ${input.owner}/${input.repo}.`
              : `Found ${items.length} ${input.state} pull request${items.length === 1 ? "" : "s"} on ${input.owner}/${input.repo}.`,
          owner: input.owner,
          repo: input.repo,
          rateLimit,
          extraMeta: { state: input.state },
        });
      } catch (error) {
        return githubFailed(error, "Could not list pull requests for that repository.");
      }
    },
  };
}

export const githubPullRequestsListAction = createGitHubPullRequestsListAction();
