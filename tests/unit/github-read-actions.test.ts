import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GITHUB_COMMITS_LIST_ACTION_ID,
  GITHUB_ISSUES_LIST_ACTION_ID,
  GITHUB_PULL_REQUEST_GET_ACTION_ID,
  GITHUB_PULL_REQUESTS_LIST_ACTION_ID,
  GITHUB_READ_ACTION_IDS,
  GITHUB_REPO_GET_ACTION_ID,
  GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
  MAX_ACTIONS_PER_GENERATION,
  executeAction,
  getAction,
  isMutatingCapability,
  listGitHubReadActions,
  listRegisteredActions,
  sanitizeActionInputSummary,
} from "@/lib/actions/index";
import type { ActionExecutionContext } from "@/lib/actions/types";
import { createGitHubCommitsListAction } from "@/lib/actions/tools/github-commits-list";
import { createGitHubIssuesListAction } from "@/lib/actions/tools/github-issues-list";
import { createGitHubPullRequestGetAction } from "@/lib/actions/tools/github-pull-request-get";
import { createGitHubPullRequestsListAction } from "@/lib/actions/tools/github-pull-requests-list";
import { createGitHubRepoGetAction } from "@/lib/actions/tools/github-repo-get";
import { createGitHubWorkflowRunsListAction } from "@/lib/actions/tools/github-workflow-runs-list";
import {
  getGitHubConfig,
  githubConfigForTests,
  githubGetJson,
  normalizePullRequest,
  redactSecrets,
} from "@/lib/github/index";

const fixtures = join(process.cwd(), "tests/fixtures/github");

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

function ctx(signal: AbortSignal = new AbortController().signal): ActionExecutionContext {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    conversationId: "22222222-2222-4222-8222-222222222222",
    messageId: "33333333-3333-4333-8333-333333333333",
    requestId: "req-github-test",
    signal,
  };
}

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "x-ratelimit-remaining": "58",
      "x-ratelimit-limit": "60",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
      ...(init?.headers ?? {}),
    },
  });
}

/** Mock fetch: public repo gate + nested resource by URL suffix. */
function publicRepoFetch(resourceBody: unknown, repoBody: unknown = loadJson("repo.json")) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (/\/repos\/[^/]+\/[^/]+$/.test(path)) return jsonResponse(repoBody);
    return jsonResponse(resourceBody);
  });
}

describe("GitHub Read registry", () => {
  it("registers six read-only GitHub Actions and keeps web.search", () => {
    const ids = listRegisteredActions().map((a) => a.id);
    expect(ids).toContain("web.search");
    for (const id of GITHUB_READ_ACTION_IDS) {
      expect(ids).toContain(id);
      expect(getAction(id)?.capability).toBe("read");
      expect(getAction(id)?.requiresConfirmation).toBe(false);
    }
    const github = listGitHubReadActions();
    expect(github).toHaveLength(6);
    expect(github.every((a) => a.capability === "read")).toBe(true);
    expect(github.every((a) => !isMutatingCapability(a.capability))).toBe(true);
  });

  it("documents one Action per generation", () => {
    expect(MAX_ACTIONS_PER_GENERATION).toBe(1);
  });
});

describe("GitHub config public-only", () => {
  it("does not attach token unless GITHUB_READ_USE_TOKEN=true", () => {
    const token = "ghp_" + "c".repeat(36);
    const idle = getGitHubConfig({ GITHUB_TOKEN: token });
    expect(idle.token).toBeNull();
    expect(idle.useToken).toBe(false);
    expect(idle.publicOnly).toBe(true);

    const armed = getGitHubConfig({ GITHUB_TOKEN: token, GITHUB_READ_USE_TOKEN: "true" });
    expect(armed.token).toBe(token);
    expect(armed.useToken).toBe(true);
    expect(armed.publicOnly).toBe(true);
  });

  it("locks API base host to api.github.com", () => {
    expect(getGitHubConfig({ GITHUB_API_BASE_URL: "https://evil.example/api" }).apiBaseUrl).toBe(
      "https://api.github.com",
    );
    expect(getGitHubConfig({ GITHUB_API_BASE_URL: "http://api.github.com" }).apiBaseUrl).toBe(
      "https://api.github.com",
    );
  });
});

describe("GitHub secret redaction", () => {
  it("redacts ghp_ / github_pat_ from audit summaries and helpers", () => {
    const token = "ghp_" + "a".repeat(36);
    const pat = "github_pat_" + "b".repeat(40);
    const summary = sanitizeActionInputSummary(GITHUB_REPO_GET_ACTION_ID, {
      owner: "habiibullahm",
      repo: "nibie-code",
      github_token: token,
      authorization: `Bearer ${token}`,
      note: `use ${pat}`,
    });
    expect(summary).toContain("habiibullahm");
    expect(summary).not.toContain(token);
    expect(summary).not.toContain(pat);
    expect(summary).toContain("[redacted]");
    expect(redactSecrets(`Authorization: Bearer ${token}`)).toContain("[redacted]");
  });
});

describe("GitHub HTTP client", () => {
  it("only sends GET and never includes Authorization when token unset", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      return jsonResponse(loadJson("repo.json"));
    });
    const result = await githubGetJson({
      path: "/repos/habiibullahm/nibie-code",
      signal: AbortSignal.timeout(5_000),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      config: githubConfigForTests({ token: null }),
    });
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps 429 to rate_limited with retry hint", async () => {
    const fetchImpl = vi.fn(
      async () =>
        jsonResponse({ message: "API rate limit exceeded" }, {
          status: 429,
          headers: { "retry-after": "30", "x-ratelimit-remaining": "0" },
        }),
    );
    await expect(
      githubGetJson({
        path: "/repos/habiibullahm/nibie-code",
        signal: AbortSignal.timeout(5_000),
        fetchImpl: fetchImpl as unknown as typeof fetch,
        config: githubConfigForTests(),
      }),
    ).rejects.toMatchObject({
      name: "GitHubApiError",
      category: "rate_limited",
      retryAfterSeconds: 30,
    });
  });

  it("rejects disallowed API hosts even if config is forged", async () => {
    await expect(
      githubGetJson({
        path: "/repos/habiibullahm/nibie-code",
        signal: AbortSignal.timeout(1_000),
        fetchImpl: vi.fn() as unknown as typeof fetch,
        config: githubConfigForTests({ apiBaseUrl: "https://evil.example" }),
      }),
    ).rejects.toMatchObject({ category: "validation" });
  });
});

describe("GitHub public-only gate", () => {
  it("rejects private repositories even when a token would have access", async () => {
    const action = createGitHubRepoGetAction({
      fetchImpl: async () => jsonResponse(loadJson("repo-private.json")),
      config: githubConfigForTests({
        token: "ghp_" + "d".repeat(36),
        useToken: true,
      }),
    });
    const result = await action.execute(
      ctx(),
      { owner: "acme", repo: "secret-sauce" },
      AbortSignal.timeout(5_000),
    );
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("private_repo");
    expect(result.summary).toMatch(/private/i);
    expect(JSON.stringify(result)).not.toContain("should never be returned");
  });

  it("blocks nested reads on private repos before listing commits", async () => {
    const fetchImpl = publicRepoFetch(loadJson("commits.json"), loadJson("repo-private.json"));
    const action = createGitHubCommitsListAction({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      config: githubConfigForTests({ token: "ghp_" + "e".repeat(36), useToken: true }),
    });
    const result = await action.execute(
      ctx(),
      { owner: "acme", repo: "secret-sauce", perPage: 10 },
      AbortSignal.timeout(5_000),
    );
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("private_repo");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("normalizePullRequest merged_at fallback", () => {
  it("treats merged_at as merged when merged flag is absent", () => {
    const pr = normalizePullRequest({
      number: 1,
      title: "Merged PR",
      state: "closed",
      html_url: "https://github.com/o/r/pull/1",
      merged_at: "2026-10-01T00:00:00Z",
      user: { login: "dev" },
      base: { ref: "main" },
      head: { ref: "feat" },
    });
    expect(pr?.merged).toBe(true);
    expect(pr?.mergedAt).toBe("2026-10-01T00:00:00Z");
  });
});

describe("GitHub Read Actions (fixture-backed)", () => {
  it("github.repo.get returns normalized public repo", async () => {
    const action = createGitHubRepoGetAction({
      fetchImpl: async () => jsonResponse(loadJson("repo.json")),
    });
    const result = await action.execute(ctx(), { owner: "habiibullahm", repo: "nibie-code" }, AbortSignal.timeout(5_000));
    expect(result.ok).toBe(true);
    expect(result.items[0]?.title).toBe("habiibullahm/nibie-code");
    expect(result.items[0]?.data?.defaultBranch).toBe("main");
    expect(result.items[0]?.data?.private).toBe(false);
  });

  it("github.commits.list returns commits after public gate", async () => {
    const action = createGitHubCommitsListAction({
      fetchImpl: publicRepoFetch(loadJson("commits.json")) as unknown as typeof fetch,
    });
    const result = await action.execute(
      ctx(),
      { owner: "habiibullahm", repo: "nibie-code", perPage: 10 },
      AbortSignal.timeout(5_000),
    );
    expect(result.ok).toBe(true);
    expect(result.items[0]?.title).toMatch(/^a9a6df3 /);
  });

  it("github.pull_request.get and list work", async () => {
    const getActionDef = createGitHubPullRequestGetAction({
      fetchImpl: publicRepoFetch(loadJson("pull.json")) as unknown as typeof fetch,
    });
    const listAction = createGitHubPullRequestsListAction({
      fetchImpl: publicRepoFetch(loadJson("pulls.json")) as unknown as typeof fetch,
    });
    const one = await getActionDef.execute(
      ctx(),
      { owner: "habiibullahm", repo: "nibie-code", number: 63 },
      AbortSignal.timeout(5_000),
    );
    const many = await listAction.execute(
      ctx(),
      { owner: "habiibullahm", repo: "nibie-code", state: "open", perPage: 10 },
      AbortSignal.timeout(5_000),
    );
    expect(one.ok).toBe(true);
    expect(one.items[0]?.title).toContain("#63");
    expect(many.ok).toBe(true);
    expect(many.items).toHaveLength(2);
  });

  it("github.issues.list filters PRs and pages when the first page is PR-heavy", async () => {
    const page1 = loadJson("issues.json"); // one issue + one PR
    const page2 = [
      {
        number: 11,
        title: "Second real issue",
        state: "open",
        html_url: "https://github.com/habiibullahm/nibie-code/issues/11",
        user: { login: "habiibullahm" },
        labels: [],
        created_at: "2026-10-03T12:00:00Z",
        updated_at: "2026-10-03T12:00:00Z",
        body: "another",
      },
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (/\/repos\/[^/]+\/[^/]+$/.test(u.pathname)) return jsonResponse(loadJson("repo.json"));
      if (u.searchParams.get("page") === "2") return jsonResponse(page2);
      return jsonResponse(page1);
    });
    const action = createGitHubIssuesListAction({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      config: githubConfigForTests({ maxPerPage: 2 }),
    });
    const result = await action.execute(
      ctx(),
      { owner: "habiibullahm", repo: "nibie-code", state: "open", perPage: 2 },
      AbortSignal.timeout(5_000),
    );
    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.title)).toEqual([
      "#10 Improve citation markers",
      "#11 Second real issue",
    ]);
    expect(result.summary).not.toMatch(/^No open issues/);
  });

  it("github.issues.list is honest when only PRs were present", async () => {
    const onlyPrs = [
      {
        number: 63,
        title: "PR as issue",
        state: "open",
        html_url: "https://github.com/habiibullahm/nibie-code/pull/63",
        user: { login: "x" },
        labels: [],
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/63" },
      },
    ];
    const action = createGitHubIssuesListAction({
      fetchImpl: publicRepoFetch(onlyPrs) as unknown as typeof fetch,
    });
    const result = await action.execute(
      ctx(),
      { owner: "habiibullahm", repo: "nibie-code", state: "open", perPage: 10 },
      AbortSignal.timeout(5_000),
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.summary).toMatch(/pull requests/i);
  });

  it("github.workflow_runs.list returns runs", async () => {
    const action = createGitHubWorkflowRunsListAction({
      fetchImpl: publicRepoFetch(loadJson("workflow-runs.json")) as unknown as typeof fetch,
    });
    const result = await action.execute(
      ctx(),
      { owner: "habiibullahm", repo: "nibie-code", perPage: 10 },
      AbortSignal.timeout(5_000),
    );
    expect(result.ok).toBe(true);
    expect(result.items[0]?.data?.conclusion).toBe("success");
  });

  it("runtime validates owner/repo and enforces one-per-generation across GitHub Actions", async () => {
    const budget = { current: 0 };
    const first = await executeAction({
      actionId: GITHUB_REPO_GET_ACTION_ID,
      rawInput: { owner: "bad owner", repo: "x" },
      ctx: ctx(),
      generationActionCount: budget,
    });
    expect(first.result.errorCode).toBe("validation_failed");
    expect(budget.current).toBe(1);
    const second = await executeAction({
      actionId: GITHUB_COMMITS_LIST_ACTION_ID,
      rawInput: { owner: "habiibullahm", repo: "nibie-code" },
      ctx: ctx(),
      generationActionCount: budget,
    });
    expect(second.result.errorCode).toBe("budget_exceeded");
  });

  it("exposes stable Action ids for UI labels", () => {
    expect(GITHUB_REPO_GET_ACTION_ID).toBe("github.repo.get");
    expect(GITHUB_COMMITS_LIST_ACTION_ID).toBe("github.commits.list");
    expect(GITHUB_PULL_REQUEST_GET_ACTION_ID).toBe("github.pull_request.get");
    expect(GITHUB_PULL_REQUESTS_LIST_ACTION_ID).toBe("github.pull_requests.list");
    expect(GITHUB_ISSUES_LIST_ACTION_ID).toBe("github.issues.list");
    expect(GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID).toBe("github.workflow_runs.list");
  });
});
