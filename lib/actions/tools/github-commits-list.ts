import "server-only";

import { z } from "zod";
import { GITHUB_COMMITS_LIST_ACTION_ID } from "@/lib/actions/ids";
import type { ActionDefinition, ActionResultItem } from "@/lib/actions/types";
import {
  githubFailed,
  githubReadJson,
  githubSuccess,
  type GitHubActionDeps,
} from "@/lib/actions/tools/github-shared";
import {
  assertPublicRepository,
  getGitHubConfig,
  githubPerPageSchema,
  githubRepoRefSchema,
  githubShaOrRefSchema,
  normalizeCommit,
} from "@/lib/github/index";

export const githubCommitsListInputSchema = githubRepoRefSchema.extend({
  sha: githubShaOrRefSchema,
  perPage: githubPerPageSchema(30, 10),
});

export type GitHubCommitsListInput = z.infer<typeof githubCommitsListInputSchema>;

export function createGitHubCommitsListAction(
  deps: GitHubActionDeps = {},
): ActionDefinition<typeof githubCommitsListInputSchema> {
  return {
    id: GITHUB_COMMITS_LIST_ACTION_ID,
    title: "GitHub Commits",
    description: "List recent commits on a public GitHub repository. Read-only.",
    capability: "read",
    requiresConfirmation: false,
    inputSchema: githubCommitsListInputSchema,
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
        await assertPublicRepository(input.owner, input.repo, {
          signal,
          config,
          fetchImpl: deps.fetchImpl,
        });
        const { data, rateLimit } = await githubReadJson<unknown[]>({
          path: `/repos/${input.owner}/${input.repo}/commits`,
          query: {
            per_page: perPage,
            ...(input.sha ? { sha: input.sha } : {}),
          },
          signal,
          config,
          fetchImpl: deps.fetchImpl,
        });
        const items: ActionResultItem[] = (Array.isArray(data) ? data : [])
          .map(normalizeCommit)
          .filter((c): c is NonNullable<typeof c> => Boolean(c))
          .map((commit) => ({
            title: `${commit.shortSha} ${commit.message}`,
            url: commit.htmlUrl,
            snippet: [commit.authorLogin ?? commit.authorName, commit.committedAt]
              .filter(Boolean)
              .join(" · "),
            provenance: "github.commit",
            data: {
              sha: commit.sha,
              shortSha: commit.shortSha,
              authorLogin: commit.authorLogin,
              committedAt: commit.committedAt,
            },
          }));
        return githubSuccess({
          items,
          summary:
            items.length === 0
              ? `No commits found for ${input.owner}/${input.repo}.`
              : `Found ${items.length} commit${items.length === 1 ? "" : "s"} on ${input.owner}/${input.repo}.`,
          owner: input.owner,
          repo: input.repo,
          rateLimit,
          extraMeta: { sha: input.sha ?? null },
        });
      } catch (error) {
        return githubFailed(error, "Could not list commits for that repository.");
      }
    },
  };
}

export const githubCommitsListAction = createGitHubCommitsListAction();
