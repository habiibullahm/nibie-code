import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

export const DEFAULT_POLL_MS = 7_000;
export const DEFAULT_MAX_WAIT_MS = 5 * 60_000;
export const EXPECTED_PROJECT_NAME = "nibie";

const TERMINAL_FAILURE = new Set(["ERROR", "CANCELED", "CANCELLED"]);
const IN_PROGRESS = new Set(["BUILDING", "QUEUED", "INITIALIZING", "UPLOADING"]);

/**
 * @typedef {{
 *   uid?: string,
 *   id?: string,
 *   url?: string,
 *   name?: string,
 *   state?: string,
 *   readyState?: string,
 *   target?: string | null,
 *   createdAt?: number,
 *   meta?: Record<string, string | undefined>,
 * }} VercelDeployment
 */

export function readVercelProjectFile(cwd = process.cwd()) {
  const path = join(cwd, ".vercel", "project.json");
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Could not parse ${path}`);
  }
  const projectId = typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
  const orgId = typeof parsed.orgId === "string" ? parsed.orgId.trim() : "";
  if (!projectId || !orgId) {
    throw new Error(`.vercel/project.json must include orgId and projectId (found projectId=${projectId || "?"}, orgId=${orgId || "?"})`);
  }
  return { projectId, orgId, path, source: "file" };
}

/**
 * Resolve project ids from gitignored `.vercel/project.json` or Cloud env
 * `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID`. Never runs interactive `vercel link`.
 * When bootstrapping from env, writes `.vercel/project.json` (gitignored) so
 * the Vercel CLI can reuse the same project.
 */
/**
 * @param {string} [cwd]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function readVercelProject(cwd = process.cwd(), env = process.env) {
  const fromFile = readVercelProjectFile(cwd);
  if (fromFile) return fromFile;

  const orgId = env.VERCEL_ORG_ID?.trim() || "";
  const projectId = env.VERCEL_PROJECT_ID?.trim() || "";
  if (!orgId || !projectId) {
    throw new Error(
      "Vercel project is not linked. Provide gitignored .vercel/project.json, or set VERCEL_ORG_ID and VERCEL_PROJECT_ID (plus VERCEL_TOKEN). This script will not run interactive vercel link.",
    );
  }

  const dir = join(cwd, ".vercel");
  const path = join(dir, "project.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ orgId, projectId }, null, 2)}\n`, "utf8");
  return { projectId, orgId, path, source: "env" };
}

export function gitHeadSha(cwd = process.cwd(), spawn = spawnSync) {
  const result = spawn("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const sha = (result.stdout || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Unexpected git HEAD SHA: ${sha || "(empty)"}`);
  }
  return sha;
}

export function resolveVercelToken(env = process.env, home = homedir()) {
  const fromEnv = env.VERCEL_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    join(home, ".local", "share", "com.vercel.cli", "auth.json"),
    join(home, "Library", "Application Support", "com.vercel.cli", "auth.json"),
    join(home, ".config", "vercel", "auth.json"),
    join(home, ".vercel", "auth.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
      if (token) return token;
    } catch {
      // ignore unreadable auth files
    }
  }
  throw new Error(
    "No Vercel API token found. Set VERCEL_TOKEN or authenticate the Vercel CLI (`vercel login` / worker secret store). Never commit tokens.",
  );
}

export function deploymentReadyState(deployment) {
  return String(deployment?.readyState || deployment?.state || "").toUpperCase();
}

export function deploymentCommitSha(deployment) {
  const meta = deployment?.meta || {};
  const raw =
    meta.githubCommitSha ||
    meta.githubCommitShaFull ||
    meta.gitCommitSha ||
    meta.commitSha ||
    "";
  return String(raw).trim().toLowerCase();
}

export function deploymentId(deployment) {
  return String(deployment?.uid || deployment?.id || "").trim();
}

export function isPreviewDeployment(deployment) {
  const target = deployment?.target;
  if (target === "production") return false;
  // Preview deployments are usually target null or "preview".
  return target == null || target === "preview";
}

export function deploymentEnvironment(deployment) {
  if (deployment?.target === "production") return "production";
  if (deployment?.target === "preview" || deployment?.target == null) return "preview";
  return String(deployment?.target || "preview");
}

export function immutableDeploymentUrl(deployment) {
  const host = String(deployment?.url || "").trim().replace(/^https?:\/\//, "");
  if (!host) {
    throw new Error(`Deployment ${deploymentId(deployment) || "(unknown)"} has no immutable url`);
  }
  return `https://${host}`;
}

/**
 * Confirm the token can call Vercel and the configured project is the expected nibie project.
 * Never logs the token.
 */
export async function verifyVercelAccess({
  token,
  orgId,
  projectId,
  fetchImpl = fetch,
  expectedProjectName = EXPECTED_PROJECT_NAME,
} = {}) {
  if (!token) throw new Error("verifyVercelAccess requires token");

  // Project / cloud tokens (e.g. vcp_*) can list deployments but often have no
  // /v2/user identity. Prefer project access as the authoritative check; treat
  // user lookup as best-effort.
  let username = "token";
  const userRes = await fetchImpl("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (userRes.ok) {
    const userPayload = await userRes.json();
    username = userPayload?.user?.username || userPayload?.user?.email || "ok";
  } else if (userRes.status === 401 || userRes.status === 403) {
    const body = await userRes.text().catch(() => "");
    throw new Error(`Vercel auth failed (${userRes.status}): ${body.slice(0, 160) || userRes.statusText}`);
  }

  const params = new URLSearchParams();
  if (orgId) params.set("teamId", orgId);
  const projectRes = await fetchImpl(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!projectRes.ok) {
    const body = await projectRes.text().catch(() => "");
    throw new Error(`Vercel project lookup failed (${projectRes.status}): ${body.slice(0, 160) || projectRes.statusText}`);
  }
  const project = await projectRes.json();
  const name = String(project?.name || "").trim();
  if (expectedProjectName && name && name !== expectedProjectName) {
    throw new Error(`Vercel project name is "${name}", expected "${expectedProjectName}"`);
  }
  return { username, projectName: name || expectedProjectName, projectId, orgId };
}

/**
 * Pick the preview deployment for the exact HEAD SHA.
 * Never returns production, even when production shares the SHA.
 * When several previews match, prefer the newest createdAt.
 */
export function pickHeadPreviewDeployment(deployments, sha) {
  const want = String(sha).trim().toLowerCase();
  const matched = (deployments || []).filter((d) => deploymentCommitSha(d) === want);
  const previews = matched.filter(isPreviewDeployment);
  if (previews.length === 0) {
    if (matched.some((d) => d?.target === "production")) {
      return { kind: "production-only", matched };
    }
    return { kind: "none", matched };
  }
  const sorted = [...previews].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { kind: "preview", deployment: sorted[0], matched: previews };
}

export async function fetchDeploymentsForSha({
  projectId,
  orgId,
  sha,
  token,
  fetchImpl = fetch,
}) {
  const params = new URLSearchParams({
    projectId,
    limit: "40",
    "meta-githubCommitSha": sha,
  });
  if (orgId) params.set("teamId", orgId);

  const response = await fetchImpl(`https://api.vercel.com/v6/deployments?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Vercel deployments API failed (${response.status}): ${body.slice(0, 200) || response.statusText}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.deployments) ? payload.deployments : [];
}

/**
 * Resolve the READY preview deployment URL for an exact commit SHA.
 * Polls while building; fails immediately on ERROR/CANCELED; rejects production-only matches.
 */
/**
 * @param {{
 *   sha: string,
 *   projectId: string,
 *   orgId: string,
 *   token: string,
 *   listDeployments?: typeof fetchDeploymentsForSha,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   now?: () => number,
 *   pollMs?: number,
 *   maxWaitMs?: number,
 *   log?: { info?: (...args: unknown[]) => void },
 * }} [options]
 */
export async function resolvePreviewDeployment({
  sha,
  projectId,
  orgId,
  token,
  listDeployments = fetchDeploymentsForSha,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  pollMs = DEFAULT_POLL_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  log = console,
} = {}) {
  if (!sha) throw new Error("resolvePreviewDeployment requires sha");
  if (!projectId || !orgId) throw new Error("resolvePreviewDeployment requires projectId and orgId");
  if (!token) throw new Error("resolvePreviewDeployment requires token");

  const started = now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    const deployments = await listDeployments({ projectId, orgId, sha, token });
    const pick = pickHeadPreviewDeployment(deployments, sha);

    if (pick.kind === "production-only") {
      throw new Error(
        `Found production deployment(s) for ${sha.slice(0, 7)} but no preview. Refusing to use production for test:qa:preview.`,
      );
    }

    if (pick.kind === "preview") {
      const state = deploymentReadyState(pick.deployment);
      const id = deploymentId(pick.deployment) || "(unknown)";
      const url = immutableDeploymentUrl(pick.deployment);
      log.info?.(`[qa:preview] commit=${sha} deployment=${id} url=${url} state=${state} attempt=${attempt}`);

      if (state === "READY") {
        const deploymentSha = deploymentCommitSha(pick.deployment);
        const environment = deploymentEnvironment(pick.deployment);
        if (deploymentSha !== String(sha).trim().toLowerCase()) {
          throw new Error(`Deployment ${id} SHA mismatch: deployment=${deploymentSha} head=${sha}`);
        }
        if (environment !== "preview") {
          throw new Error(`Deployment ${id} environment is ${environment}, expected preview`);
        }
        return {
          sha,
          deploymentId: id,
          url,
          state,
          deploymentSha,
          environment,
          deployment: pick.deployment,
        };
      }
      if (TERMINAL_FAILURE.has(state)) {
        throw new Error(`Preview deployment ${id} for ${sha.slice(0, 7)} ended in ${state}`);
      }
      if (!IN_PROGRESS.has(state) && state) {
        // Unknown non-ready state: keep polling until timeout unless clearly failed.
        log.info?.(`[qa:preview] waiting on unexpected state=${state} deployment=${id}`);
      }
    } else {
      log.info?.(`[qa:preview] commit=${sha} no preview deployment yet (attempt=${attempt})`);
    }

    if (now() - started >= maxWaitMs) {
      throw new Error(
        `Timed out after ${Math.round(maxWaitMs / 1000)}s waiting for READY preview deployment for ${sha.slice(0, 7)}`,
      );
    }
    await sleep(pollMs);
  }
}

/**
 * @param {{
 *   baseUrl: string,
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   spawn?: (...args: any[]) => { status?: number | null },
 *   execPath?: string,
 *   useVercelEnvRun?: boolean,
 * }} [options]
 */
export function runQaSmoke({
  baseUrl,
  argv = [],
  env = process.env,
  spawn = spawnSync,
  execPath = process.execPath,
  useVercelEnvRun = false,
} = {}) {
  if (!baseUrl?.trim()) throw new Error("runQaSmoke requires baseUrl");
  const script = fileURLToPath(new URL("./qa-smoke.mjs", import.meta.url));
  const childEnv = { ...env, E2E_BASE_URL: baseUrl.trim() };

  // Protected previews need short-lived VERCEL_OIDC_TOKEN. Prefer wrapping with
  // `vercel env run` when a token is available and OIDC is not already present.
  const needsOidc =
    useVercelEnvRun ||
    (/vercel\.app$/i.test(new URL(baseUrl).hostname) && !childEnv.VERCEL_OIDC_TOKEN?.trim() && Boolean(childEnv.VERCEL_TOKEN?.trim()));

  let command = execPath;
  let args = [script, ...argv];
  if (needsOidc) {
    command = process.platform === "win32" ? "npx.cmd" : "npx";
    args = ["--yes", "vercel@latest", "env", "run", "--", execPath, script, ...argv];
  }

  const result = spawn(command, args, {
    stdio: "inherit",
    env: childEnv,
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const env = deps.env || process.env;
  const log = deps.log || console;

  const project = (deps.readProject || readVercelProject)(cwd, env);
  const sha = (deps.gitHead || gitHeadSha)(cwd, deps.spawn || spawnSync);
  const token = (deps.resolveToken || resolveVercelToken)(env, deps.home);

  const identity = await (deps.verifyAccess || verifyVercelAccess)({
    token,
    orgId: project.orgId,
    projectId: project.projectId,
    fetchImpl: deps.fetchImpl,
  });
  log.info?.(
    `[qa:preview] vercel ok user=${identity.username} project=${identity.projectName} source=${project.source || "file"}`,
  );
  log.info?.(`[qa:preview] resolving preview for HEAD ${sha} (project=${project.projectId})`);

  const resolved = await (deps.resolve || resolvePreviewDeployment)({
    sha,
    projectId: project.projectId,
    orgId: project.orgId,
    token,
    listDeployments: deps.listDeployments,
    sleep: deps.sleep,
    now: deps.now,
    pollMs: deps.pollMs,
    maxWaitMs: deps.maxWaitMs,
    log,
  });

  log.info?.(
    `[qa:preview] READY deployment=${resolved.deploymentId} url=${resolved.url} git=${resolved.deploymentSha} env=${resolved.environment}`,
  );
  log.info?.(`[qa:preview] running test:qa:smoke against ${resolved.url}`);
  const status = (deps.runSmoke || runQaSmoke)({
    baseUrl: resolved.url,
    argv,
    env: { ...env, VERCEL_TOKEN: token },
    spawn: deps.spawn || spawnSync,
  });
  return status;
}

const isDirectRun =
  Boolean(process.argv[1]) && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().then(
    (status) => process.exit(status),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
