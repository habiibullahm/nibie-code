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
  assertPublicRepository,
  getGitHubConfig,
  githubIssueStateSchema,
  githubPerPageSchema,
  githubRepoRefSchema,
  isPullRequestIssue,
  normalizeIssue,
  type GitHubRateLimitInfo,
} from "@/lib/github/index";

export const githubIssuesListInputSchema = githubRepoRefSchema.extend({
  state: githubIssueStateSchema,
  perPage: githubPerPageSchema(30, 10),
});

export type GitHubIssuesListInput = z.infer<typeof githubIssuesListInputSchema>;

const MAX_ISSUE_PAGES = 3;

export function createGitHubIssuesListAction(
  deps: GitHubActionDeps = {},
): ActionDefinition<typeof githubIssuesListInputSchema> {
  return {
    id: GITHUB_ISSUES_LIST_ACTION_ID,
    title: "GitHub Issues",
    description: "List issues on a public GitHub repository (pull requests excluded). Read-only.",
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
        await assertPublicRepository(input.owner, input.repo, {
          signal,
          config,
          fetchImpl: deps.fetchImpl,
        });

        // Issues API mixes PRs into the same feed. Page until we gather enough real issues
        // (bounded) so a PR-heavy first page does not falsely report "no issues".
        const collected: ActionResultItem[] = [];
        let page = 1;
        let apiRowsSeen = 0;
        let prRowsSkipped = 0;
        let rateLimit: GitHubRateLimitInfo | undefined;

        while (collected.length < perPage && page <= MAX_ISSUE_PAGES) {
          if (signal.aborted || ctx.signal.aborted) {
            return {
              ok: false,
              items: [],
              summary: "GitHub request was cancelled.",
              errorCode: "aborted",
              errorMessage: "aborted",
            };
          }
          const { data, rateLimit: pageRate } = await githubReadJson<unknown[]>({
            path: `/repos/${input.owner}/${input.repo}/issues`,
            query: { state: input.state, per_page: config.maxPerPage, page },
            signal,
            config,
            fetchImpl: deps.fetchImpl,
          });
          rateLimit = pageRate;
          const rows = Array.isArray(data) ? data : [];
          if (!rows.length) break;
          apiRowsSeen += rows.length;
          for (const raw of rows) {
            if (isPullRequestIssue(raw)) {
              prRowsSkipped += 1;
              continue;
            }
            const issue = normalizeIssue(raw);
            if (!issue) continue;
            collected.push({
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
            });
            if (collected.length >= perPage) break;
          }
          if (rows.length < config.maxPerPage) break;
          page += 1;
        }

        let summary: string;
        if (collected.length === 0) {
          summary =
            apiRowsSeen > 0 && prRowsSkipped > 0
              ? `No ${input.state} issues found for ${input.owner}/${input.repo} in the first ${apiRowsSeen} items (they were pull requests; PRs are listed separately).`
              : `No ${input.state} issues for ${input.owner}/${input.repo}.`;
        } else {
          summary = `Found ${collected.length} ${input.state} issue${collected.length === 1 ? "" : "s"} on ${input.owner}/${input.repo}.`;
        }

        return githubSuccess({
          items: collected,
          summary,
          owner: input.owner,
          repo: input.repo,
          rateLimit,
          extraMeta: {
            state: input.state,
            pagesScanned: page,
            pullRequestsSkipped: prRowsSkipped,
            apiRowsSeen,
          },
        });
      } catch (error) {
        return githubFailed(error, "Could not list issues for that repository.");
      }
    },
  };
}

export const githubIssuesListAction = createGitHubIssuesListAction();
