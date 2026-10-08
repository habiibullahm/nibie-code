import { describe, expect, it } from "vitest";
import {
  GITHUB_COMMITS_LIST_ACTION_ID,
  GITHUB_PULL_REQUEST_GET_ACTION_ID,
  GITHUB_PULL_REQUESTS_LIST_ACTION_ID,
  GITHUB_REPO_GET_ACTION_ID,
  GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
} from "@/lib/actions/ids";
import { decideGitHubRead } from "@/lib/github/routing";

describe("decideGitHubRead", () => {
  it("returns no intent for ordinary chat", () => {
    expect(decideGitHubRead("Explain how HTTP works")).toEqual({ use: false, reason: "no_github_intent" });
    expect(decideGitHubRead("")).toEqual({ use: false, reason: "no_github_intent" });
  });

  it("routes a PR URL to pull_request.get", () => {
    const decision = decideGitHubRead("Please review https://github.com/habiibullahm/nibie-code/pull/63");
    expect(decision).toMatchObject({
      use: true,
      actionId: GITHUB_PULL_REQUEST_GET_ACTION_ID,
      input: { owner: "habiibullahm", repo: "nibie-code", number: 63 },
    });
  });

  it("routes open PRs for Nibie alias to pull_requests.list (one Action)", () => {
    const decision = decideGitHubRead("Check Nibie latest main, open PRs, CI status, and tell me the blockers.");
    expect(decision.use).toBe(true);
    if (!decision.use) return;
    expect(decision.actionId).toBe(GITHUB_PULL_REQUESTS_LIST_ACTION_ID);
    expect(decision.input).toMatchObject({ owner: "habiibullahm", repo: "nibie-code", state: "open" });
  });

  it("routes CI/workflow asks to workflow_runs.list", () => {
    const decision = decideGitHubRead("What's the CI status on habiibullahm/nibie-code?");
    expect(decision).toMatchObject({
      use: true,
      actionId: GITHUB_WORKFLOW_RUNS_LIST_ACTION_ID,
      input: { owner: "habiibullahm", repo: "nibie-code" },
    });
  });

  it("routes commits / latest main", () => {
    const decision = decideGitHubRead("Show recent commits on main for github.com/habiibullahm/nibie-code");
    expect(decision).toMatchObject({
      use: true,
      actionId: GITHUB_COMMITS_LIST_ACTION_ID,
      input: { owner: "habiibullahm", repo: "nibie-code", sha: "main" },
    });
  });

  it("routes repo URL to repo.get", () => {
    const decision = decideGitHubRead("What's the github repo https://github.com/vercel/next.js ?");
    expect(decision).toMatchObject({
      use: true,
      actionId: GITHUB_REPO_GET_ACTION_ID,
      input: { owner: "vercel", repo: "next.js" },
    });
  });

  it("rejects github.com path-traversal URLs", () => {
    expect(decideGitHubRead("check https://github.com/foo/../admin/secrets").use).toBe(false);
    expect(decideGitHubRead("review github.com/../admin/x").use).toBe(false);
  });
});
