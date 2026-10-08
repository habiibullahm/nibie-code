import {
  GITHUB_COMMITS_LIST_ACTION_ID,
  GITHUB_ISSUES_LIST_ACTION_ID,
  GITHUB_PULL_REQUEST_GET_ACTION_ID,
  GITHUB_PULL_REQUESTS_LIST_ACTION_ID,
  GITHUB_REPO_GET_ACTION_ID,
  GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
  type GitHubReadActionId,
} from "@/lib/actions/ids";
import { githubOwnerSchema, githubRepoSchema } from "@/lib/github/schemas";

export type GitHubRouteReason =
  | "pull_request_url"
  | "pull_request_number"
  | "pull_requests_list"
  | "workflow_runs"
  | "issues_list"
  | "commits_list"
  | "repo_url"
  | "repo_shorthand"
  | "no_github_intent";

export type GitHubReadDecision =
  | { use: false; reason: GitHubRouteReason }
  | {
      use: true;
      reason: GitHubRouteReason;
      actionId: GitHubReadActionId;
      input: Record<string, unknown>;
      title: string;
    };

/** Product dogfood alias — public Nibie repo. */
const NIBIE_ALIAS = { owner: "habiibullahm", repo: "nibie-code" } as const;

const GITHUB_URL_REPO =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})(?:\/|$|\s|[?#])/i;

const GITHUB_URL_PR =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,7})\b/i;

const OWNER_REPO_SHORTHAND =
  /\b([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})\b/;

const GITHUB_INTENT =
  /\b(?:github|gh\b|pull\s*requests?|\bPRs?\b|open\s+prs?|workflow\s*runs?|actions\s+runs?|\bCI\b|issues?|commits?|repo(?:sitory)?)\b/i;

const PR_LIST_INTENT =
  /\b(?:open\s+prs?|open\s+pull\s+requests?|pull\s+requests?|list\s+prs?|prs?\s+on|review\s+(?:the\s+)?(?:open\s+)?prs?)\b/i;

const PR_NUMBER_INTENT =
  /\b(?:pull\s*request|pr)\s*#?\s*(\d{1,7})\b/i;

const WORKFLOW_INTENT =
  /\b(?:workflow\s*runs?|github\s+actions|\bCI\b|check\s+runs?|actions\s+status|ci\s+status|blockers?)\b/i;

const ISSUES_INTENT = /\b(?:open\s+issues?|list\s+issues?|github\s+issues?|\bissues?\b)\b/i;

const COMMITS_INTENT =
  /\b(?:commits?|commit\s+history|latest\s+main|recent\s+commits?|on\s+main|default\s+branch)\b/i;

const REPO_INTENT = /\b(?:github\s+repo(?:sitory)?|repo(?:sitory)?\s+(?:info|details|metadata)|check\s+(?:the\s+)?repo)\b/i;

function parseOwnerRepo(owner: string, repo: string): { owner: string; repo: string } | null {
  const o = githubOwnerSchema.safeParse(owner);
  const r = githubRepoSchema.safeParse(repo);
  if (!o.success || !r.success) return null;
  if (r.data.includes("..")) return null;
  return { owner: o.data, repo: r.data };
}

function resolveRepo(query: string): { owner: string; repo: string } | null {
  // Reject github.com URLs that attempt path traversal before any shorthand match.
  if (/github\.com\/[^?\s]*\.\./i.test(query)) return null;

  const urlPr = query.match(GITHUB_URL_PR);
  if (urlPr) {
    const parsed = parseOwnerRepo(urlPr[1]!, urlPr[2]!);
    if (parsed) return parsed;
  }
  const urlRepo = query.match(GITHUB_URL_REPO);
  if (urlRepo) {
    const parsed = parseOwnerRepo(urlRepo[1]!, urlRepo[2]!);
    if (parsed) return parsed;
  }
  // Product alias when the ask is about Nibie on GitHub.
  if (/\bnibie(?:-code)?\b/i.test(query) && (GITHUB_INTENT.test(query) || PR_LIST_INTENT.test(query) || WORKFLOW_INTENT.test(query) || COMMITS_INTENT.test(query) || ISSUES_INTENT.test(query) || /\bmain\b/i.test(query))) {
    return { ...NIBIE_ALIAS };
  }
  const shorthand = query.match(OWNER_REPO_SHORTHAND);
  if (shorthand && GITHUB_INTENT.test(query)) {
    const parsed = parseOwnerRepo(shorthand[1]!, shorthand[2]!);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Deterministic GitHub Read router — exactly one Action + validated input, or no-op.
 * No LLM tool loop. Prefer GitHub over web when this returns use:true.
 */
export function decideGitHubRead(query: string): GitHubReadDecision {
  const text = query.trim();
  if (!text) return { use: false, reason: "no_github_intent" };

  const urlPr = text.match(GITHUB_URL_PR);
  if (urlPr) {
    const repo = parseOwnerRepo(urlPr[1]!, urlPr[2]!);
    const number = Number.parseInt(urlPr[3]!, 10);
    if (repo && Number.isFinite(number) && number > 0) {
      return {
        use: true,
        reason: "pull_request_url",
        actionId: GITHUB_PULL_REQUEST_GET_ACTION_ID,
        input: { ...repo, number },
        title: "GitHub Pull Request",
      };
    }
  }

  const repo = resolveRepo(text);
  if (!repo) return { use: false, reason: "no_github_intent" };

  const prNumberMatch = text.match(PR_NUMBER_INTENT);
  if (prNumberMatch && !urlPr) {
    const number = Number.parseInt(prNumberMatch[1]!, 10);
    if (Number.isFinite(number) && number > 0) {
      return {
        use: true,
        reason: "pull_request_number",
        actionId: GITHUB_PULL_REQUEST_GET_ACTION_ID,
        input: { ...repo, number },
        title: "GitHub Pull Request",
      };
    }
  }

  if (PR_LIST_INTENT.test(text)) {
    return {
      use: true,
      reason: "pull_requests_list",
      actionId: GITHUB_PULL_REQUESTS_LIST_ACTION_ID,
      input: { ...repo, state: "open", perPage: 10 },
      title: "GitHub Pull Requests",
    };
  }

  if (WORKFLOW_INTENT.test(text)) {
    return {
      use: true,
      reason: "workflow_runs",
      actionId: GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
      input: { ...repo, perPage: 10 },
      title: "GitHub Workflow Runs",
    };
  }

  if (ISSUES_INTENT.test(text) && !PR_LIST_INTENT.test(text)) {
    return {
      use: true,
      reason: "issues_list",
      actionId: GITHUB_ISSUES_LIST_ACTION_ID,
      input: { ...repo, state: "open", perPage: 10 },
      title: "GitHub Issues",
    };
  }

  if (COMMITS_INTENT.test(text)) {
    return {
      use: true,
      reason: "commits_list",
      actionId: GITHUB_COMMITS_LIST_ACTION_ID,
      input: { ...repo, sha: "main", perPage: 10 },
      title: "GitHub Commits",
    };
  }

  if (REPO_INTENT.test(text) || GITHUB_URL_REPO.test(text) || (GITHUB_INTENT.test(text) && OWNER_REPO_SHORTHAND.test(text))) {
    return {
      use: true,
      reason: GITHUB_URL_REPO.test(text) ? "repo_url" : "repo_shorthand",
      actionId: GITHUB_REPO_GET_ACTION_ID,
      input: { ...repo },
      title: "GitHub Repository",
    };
  }

  // Nibie alias with vague "check … main" style asks → commits on main.
  if (repo.owner === NIBIE_ALIAS.owner && repo.repo === NIBIE_ALIAS.repo && /\b(?:check|latest|main|status)\b/i.test(text)) {
    return {
      use: true,
      reason: "commits_list",
      actionId: GITHUB_COMMITS_LIST_ACTION_ID,
      input: { ...repo, sha: "main", perPage: 10 },
      title: "GitHub Commits",
    };
  }

  return { use: false, reason: "no_github_intent" };
}
