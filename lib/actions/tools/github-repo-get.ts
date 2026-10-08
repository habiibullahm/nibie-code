import "server-only";

import { z } from "zod";
import { GITHUB_REPO_GET_ACTION_ID } from "@/lib/actions/ids";
import type { ActionDefinition, ActionResultItem } from "@/lib/actions/types";
import {
  githubFailed,
  githubReadJson,
  githubSuccess,
  type GitHubActionDeps,
} from "@/lib/actions/tools/github-shared";
import { githubRepoRefSchema, normalizeRepo } from "@/lib/github/index";

export const githubRepoGetInputSchema = githubRepoRefSchema;

export type GitHubRepoGetInput = z.infer<typeof githubRepoGetInputSchema>;

export function createGitHubRepoGetAction(deps: GitHubActionDeps = {}): ActionDefinition<
  typeof githubRepoGetInputSchema
> {
  return {
    id: GITHUB_REPO_GET_ACTION_ID,
    title: "GitHub Repository",
    description: "Read public metadata for a GitHub repository. Read-only.",
    capability: "read",
    requiresConfirmation: false,
    inputSchema: githubRepoGetInputSchema,
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
        const { data, rateLimit } = await githubReadJson<unknown>({
          path: `/repos/${input.owner}/${input.repo}`,
          signal,
          config: deps.config,
          fetchImpl: deps.fetchImpl,
        });
        const repo = normalizeRepo(data);
        if (!repo) {
          return {
            ok: false,
            items: [],
            summary: "GitHub returned an unexpected repository payload.",
            errorCode: "execution_failed",
            errorMessage: "parse_error",
          };
        }
        const item: ActionResultItem = {
          title: repo.fullName,
          url: repo.htmlUrl,
          snippet: repo.description ?? undefined,
          provenance: "github.repo",
          data: {
            defaultBranch: repo.defaultBranch,
            private: repo.private,
            language: repo.language,
            stargazersCount: repo.stargazersCount,
            forksCount: repo.forksCount,
            openIssuesCount: repo.openIssuesCount,
            pushedAt: repo.pushedAt,
            updatedAt: repo.updatedAt,
          },
        };
        return githubSuccess({
          items: [item],
          summary: `Loaded ${repo.fullName}.`,
          owner: input.owner,
          repo: input.repo,
          rateLimit,
          extraMeta: { defaultBranch: repo.defaultBranch, private: repo.private },
        });
      } catch (error) {
        return githubFailed(error, "Could not load that GitHub repository.");
      }
    },
  };
}

export const githubRepoGetAction = createGitHubRepoGetAction();
