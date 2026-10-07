import { describe, expect, it, vi } from "vitest";
import {
  deploymentCommitSha,
  immutableDeploymentUrl,
  isPreviewDeployment,
  pickHeadPreviewDeployment,
  resolvePreviewDeployment,
  runQaSmoke,
} from "../../scripts/qa-preview-smoke.mjs";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    uid: "dpl_preview",
    url: "nibie-git-feat-x-team.vercel.app",
    readyState: "READY",
    target: null,
    createdAt: 100,
    meta: { githubCommitSha: SHA },
    ...overrides,
  };
}

const silentLog = { info: vi.fn() };

describe("qa-preview-smoke helpers", () => {
  it("reads commit SHA from deployment meta", () => {
    expect(deploymentCommitSha(deployment())).toBe(SHA);
    expect(deploymentCommitSha(deployment({ meta: { gitCommitSha: OTHER } }))).toBe(OTHER);
  });

  it("treats only non-production targets as preview", () => {
    expect(isPreviewDeployment(deployment({ target: null }))).toBe(true);
    expect(isPreviewDeployment(deployment({ target: "preview" }))).toBe(true);
    expect(isPreviewDeployment(deployment({ target: "production" }))).toBe(false);
  });

  it("builds an immutable https deployment URL", () => {
    expect(immutableDeploymentUrl(deployment())).toBe("https://nibie-git-feat-x-team.vercel.app");
    expect(immutableDeploymentUrl(deployment({ url: "https://already.vercel.app" }))).toBe("https://already.vercel.app");
  });

  it("picks the HEAD preview and ignores wrong SHAs", () => {
    const pick = pickHeadPreviewDeployment(
      [
        deployment({ uid: "wrong", meta: { githubCommitSha: OTHER }, createdAt: 999 }),
        deployment({ uid: "head", createdAt: 50 }),
      ],
      SHA,
    );
    expect(pick.kind).toBe("preview");
    expect(pick.deployment?.uid).toBe("head");
  });

  it("when multiple previews match HEAD, picks the newest createdAt", () => {
    const pick = pickHeadPreviewDeployment(
      [
        deployment({ uid: "older", createdAt: 10 }),
        deployment({ uid: "newer", createdAt: 90, url: "newer.vercel.app" }),
      ],
      SHA,
    );
    expect(pick.kind).toBe("preview");
    expect(pick.deployment?.uid).toBe("newer");
  });

  it("rejects production-only matches for the same SHA", () => {
    const pick = pickHeadPreviewDeployment(
      [deployment({ uid: "prod", target: "production", url: "nibie-ai.vercel.app" })],
      SHA,
    );
    expect(pick.kind).toBe("production-only");
  });
});

describe("resolvePreviewDeployment", () => {
  it("returns immediately when the HEAD preview is READY", async function () {
    const listDeployments = vi.fn(async () => [deployment()]);
    const resolved = await resolvePreviewDeployment({
      sha: SHA,
      projectId: "prj_x",
      orgId: "team_x",
      token: "tok",
      listDeployments,
      sleep: vi.fn(),
      log: silentLog,
    });
    expect(resolved.url).toBe("https://nibie-git-feat-x-team.vercel.app");
    expect(resolved.deploymentId).toBe("dpl_preview");
    expect(resolved.state).toBe("READY");
    expect(listDeployments).toHaveBeenCalledTimes(1);
  });

  it("polls BUILDING then returns READY", async function () {
    const listDeployments = vi
      .fn()
      .mockResolvedValueOnce([deployment({ readyState: "BUILDING" })])
      .mockResolvedValueOnce([deployment({ readyState: "READY" })]);
    const sleep = vi.fn(async () => undefined);
    const resolved = await resolvePreviewDeployment({
      sha: SHA,
      projectId: "prj_x",
      orgId: "team_x",
      token: "tok",
      listDeployments,
      sleep,
      pollMs: 5,
      log: silentLog,
    });
    expect(resolved.state).toBe("READY");
    expect(listDeployments).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
  });

  it("fails immediately on ERROR", async function () {
    await expect(
      resolvePreviewDeployment({
        sha: SHA,
        projectId: "prj_x",
        orgId: "team_x",
        token: "tok",
        listDeployments: async () => [deployment({ readyState: "ERROR" })],
        sleep: vi.fn(),
        log: silentLog,
      }),
    ).rejects.toThrow(/ended in ERROR/);
  });

  it("fails immediately on CANCELED", async function () {
    await expect(
      resolvePreviewDeployment({
        sha: SHA,
        projectId: "prj_x",
        orgId: "team_x",
        token: "tok",
        listDeployments: async () => [deployment({ readyState: "CANCELED" })],
        sleep: vi.fn(),
        log: silentLog,
      }),
    ).rejects.toThrow(/ended in CANCELED/);
  });

  it("never selects a deployment for the wrong SHA", async function () {
    const sleep = vi.fn(async () => undefined);
    let now = 0;
    await expect(
      resolvePreviewDeployment({
        sha: SHA,
        projectId: "prj_x",
        orgId: "team_x",
        token: "tok",
        listDeployments: async () => [deployment({ meta: { githubCommitSha: OTHER }, readyState: "READY" })],
        sleep,
        now: () => {
          now += 10_000;
          return now;
        },
        pollMs: 1,
        maxWaitMs: 15_000,
        log: silentLog,
      }),
    ).rejects.toThrow(/Timed out/);
  });

  it("rejects production deployment even when SHA matches", async function () {
    await expect(
      resolvePreviewDeployment({
        sha: SHA,
        projectId: "prj_x",
        orgId: "team_x",
        token: "tok",
        listDeployments: async () => [deployment({ target: "production", url: "nibie-ai.vercel.app" })],
        sleep: vi.fn(),
        log: silentLog,
      }),
    ).rejects.toThrow(/Refusing to use production/);
  });

  it("times out when preview never becomes READY", async function () {
    let now = 0;
    await expect(
      resolvePreviewDeployment({
        sha: SHA,
        projectId: "prj_x",
        orgId: "team_x",
        token: "tok",
        listDeployments: async () => [deployment({ readyState: "BUILDING" })],
        sleep: vi.fn(async () => undefined),
        now: () => {
          const value = now;
          now += 60_000;
          return value;
        },
        pollMs: 1,
        maxWaitMs: 120_000,
        log: silentLog,
      }),
    ).rejects.toThrow(/Timed out after 120s/);
  });
});

describe("runQaSmoke", () => {
  it("spawns qa-smoke with E2E_BASE_URL only in the child env", () => {
    const calls: Array<{ execPath: string; args: string[]; options: { env: NodeJS.ProcessEnv } }> = [];
    const spawn = ((execPath: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      calls.push({ execPath, args, options });
      return { status: 0 };
    }) as typeof import("node:child_process").spawnSync;

    const parentEnv: NodeJS.ProcessEnv = { ...process.env, E2E_USER_EMAIL: "qa@example.com" };
    delete parentEnv.E2E_BASE_URL;

    const status = runQaSmoke({
      baseUrl: "https://preview.example.vercel.app",
      env: parentEnv,
      spawn,
      execPath: "/usr/bin/node",
      argv: ["--reporter=line"],
    });

    expect(status).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].execPath).toBe("/usr/bin/node");
    expect(calls[0].args[0]).toMatch(/scripts\/qa-smoke\.mjs$/);
    expect(calls[0].args.slice(1)).toEqual(["--reporter=line"]);
    expect(calls[0].options.env.E2E_BASE_URL).toBe("https://preview.example.vercel.app");
    expect(calls[0].options.env.E2E_USER_EMAIL).toBe("qa@example.com");
    expect(parentEnv.E2E_BASE_URL).toBeUndefined();
  });
});
