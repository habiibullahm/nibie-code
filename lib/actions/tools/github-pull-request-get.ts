import "server-only";

import { z } from "zod";
import { GITHUB_PULL_REQUEST_GET_ACTION_ID } from "@/lib/actions/ids";
import type { ActionDefinition, ActionResultItem } from "@/lib/actions/types";
import {
  githubFailed,
  githubReadJson,
  githubSuccess,
  type GitHubActionDeps,
} from "@/lib/actions/tools/github-shared";
import {
  assertPublicRepository,
  githubPullNumberSchema,
  githubRepoRefSchema,
  normalizePullRequest,
} from "@/lib/github/index";

export const githubPullRequestGetInputSchema = githubRepoRefSchema.extend({
  number: githubPullNumberSchema,
});

export type GitHubPullRequestGetInput = z.infer<typeof githubPullRequestGetInputSchema>;

export function createGitHubPullRequestGetAction(
  deps: GitHubActionDeps = {},
): ActionDefinition<typeof githubPullRequestGetInputSchema> {
  return {
    id: GITHUB_PULL_REQUEST_GET_ACTION_ID,
    title: "GitHub Pull Request",
    description: "Read one pull request from a public GitHub repository. Read-only.",
    capability: "read",
    requiresConfirmation: false,
    inputSchema: githubPullRequestGetInputSchema,
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
      try {
        await assertPublicRepository(input.owner, input.repo, {
          signal,
          config: deps.config,
          fetchImpl: deps.fetchImpl,
        });
        const { data, rateLimit } = await githubReadJson<unknown>({
          path: `/repos/${input.owner}/${input.repo}/pulls/${input.number}`,
          signal,
          config: deps.config,
          fetchImpl: deps.fetchImpl,
        });
        const pr = normalizePullRequest(data);
        if (!pr) {
          return {
            ok: false,
            items: [],
            summary: "GitHub returned an unexpected pull request payload.",
            errorCode: "execution_failed",
            errorMessage: "parse_error",
          };
        }
        const item: ActionResultItem = {
          title: `#${pr.number} ${pr.title}`,
          url: pr.htmlUrl,
          snippet: pr.bodyPreview ?? undefined,
          provenance: "github.pull_request",
          data: {
            number: pr.number,
            state: pr.state,
            draft: pr.draft,
            merged: pr.merged,
            authorLogin: pr.authorLogin,
            baseRef: pr.baseRef,
            headRef: pr.headRef,
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            mergedAt: pr.mergedAt,
          },
        };
        return githubSuccess({
          items: [item],
          summary: `Loaded PR #${pr.number} (${pr.state}${pr.draft ? ", draft" : ""}${pr.merged ? ", merged" : ""}).`,
          owner: input.owner,
          repo: input.repo,
          rateLimit,
          extraMeta: { number: pr.number, state: pr.state, merged: pr.merged },
        });
      } catch (error) {
        return githubFailed(error, "Could not load that pull request.");
      }
    },
  };
}

export const githubPullRequestGetAction = createGitHubPullRequestGetAction();
