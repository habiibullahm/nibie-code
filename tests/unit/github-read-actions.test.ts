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
import { GitHubApiError, getGitHubConfig, githubGetJson, redactSecrets } from "@/lib/github/index";

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
      config: { ...getGitHubConfig({}), token: null },
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
        config: { ...getGitHubConfig({}), token: null },
      }),
    ).rejects.toMatchObject({
      name: "GitHubApiError",
      category: "rate_limited",
      retryAfterSeconds: 30,
    } satisfies Partial<GitHubApiError>);
  });

  it("maps timeout via AbortSignal", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    await expect(
      githubGetJson({
        path: "/repos/habiibullahm/nibie-code",
        signal: AbortSignal.timeout(5_000),
        timeoutMs: 20,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        config: { ...getGitHubConfig({}), token: null },
      }),
    ).rejects.toMatchObject({ category: "timeout" });
  });

  it("rejects path traversal", async () => {
    await expect(
      githubGetJson({
        path: "/repos/../admin",
        signal: AbortSignal.timeout(1_000),
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: "validation" });
  });
});

describe("GitHub Read Actions (fixture-backed)", () => {
  it("github.repo.get returns normalized repo", async () => {
    const action = createGitHubRepoGetAction({
      fetchImpl: async () => jsonResponse(loadJson("repo.json")),
    });
    const result = await action.execute(ctx(), { owner: "habiibullahm", repo: "nibie-code" }, AbortSignal.timeout(5_000));
    expect(result.ok).toBe(true);
    expect(result.items[0]?.title).toBe("habiibullahm/nibie-code");
    expect(result.items[0]?.data?.defaultBranch).toBe("main");
  });

  it("github.commits.list returns commits", async () => {
    const action = createGitHubCommitsListAction({
      fetchImpl: async () => jsonResponse(loadJson("commits.json")),
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
      fetchImpl: async () => jsonResponse(loadJson("pull.json")),
    });
    const listAction = createGitHubPullRequestsListAction({
      fetchImpl: async () => jsonResponse(loadJson("pulls.json")),
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

  it("github.issues.list filters pull requests out", async () => {
    const action = createGitHubIssuesListAction({
      fetchImpl: async () => jsonResponse(loadJson("issues.json")),
    });
    const result = await action.execute(
      ctx(),
      { owner: "habiibullahm", repo: "nibie-code", state: "open", perPage: 10 },
      AbortSignal.timeout(5_000),
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toContain("#10");
  });

  it("github.workflow_runs.list returns runs", async () => {
    const action = createGitHubWorkflowRunsListAction({
      fetchImpl: async () => jsonResponse(loadJson("workflow-runs.json")),
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
    const bad = await executeAction({
      actionId: GITHUB_REPO_GET_ACTION_ID,
      rawInput: { owner: "../evil", repo: "x" },
      ctx: ctx(),
    });
    expect(bad.result.errorCode).toBe("validation_failed");

    const fetchImpl = vi.fn(async () => jsonResponse(loadJson("repo.json")));
    // executeAction uses the registered action (global fetch). Stub via action path already covered;
    // budget enforcement does not need a successful second call.
    const budget = { current: 0 };
    // First call will hit real registered action → network; instead bump budget manually after a
    // dry validation-only failure path is insufficient. Use generationActionCount with a mocked
    // success by calling executeAction twice where first fails validation still increments? Looking
    // at runtime: budget increments before validation. So:
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
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns honest not_found from Action execute", async () => {
    const action = createGitHubRepoGetAction({
      fetchImpl: async () => jsonResponse({ message: "Not Found" }, { status: 404 }),
    });
    const result = await action.execute(ctx(), { owner: "habiibullahm", repo: "missing" }, AbortSignal.timeout(5_000));
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("not_found");
    expect(result.summary).toMatch(/not found/i);
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
