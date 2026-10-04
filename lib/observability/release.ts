import "server-only";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type ReleaseEnvironment = "production" | "preview" | "development";

export type ReleaseIdentity = {
  sha: string;
  shortSha: string;
  branch: string;
  environment: ReleaseEnvironment;
};

export type PublicHealthRelease = {
  status: "ok";
  release: string;
  environment: ReleaseEnvironment;
};

const LOCAL = "local";

function commitSha(value: string | undefined) {
  const sha = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null;
}

function branchName(value: string | undefined) {
  const branch = value?.trim() ?? "";
  if (!branch || branch.length > 128) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) return null;
  return branch;
}

function environmentName(env: Env): ReleaseEnvironment {
  const vercel = env.VERCEL_ENV?.trim();
  if (vercel === "production" || vercel === "preview" || vercel === "development") return vercel;
  return "development";
}

// Deployment identity is the Vercel git commit. package.json version is not a release id.
export function readReleaseIdentity(env: Env = process.env): ReleaseIdentity {
  const sha = commitSha(env.VERCEL_GIT_COMMIT_SHA) ?? LOCAL;
  return {
    sha,
    shortSha: sha === LOCAL ? LOCAL : sha.slice(0, 7),
    branch: branchName(env.VERCEL_GIT_COMMIT_REF) ?? LOCAL,
    environment: environmentName(env),
  };
}

// Public health omits the branch. Server logs keep it.
export function publicHealthRelease(env: Env = process.env): PublicHealthRelease {
  const identity = readReleaseIdentity(env);
  return { status: "ok", release: identity.shortSha, environment: identity.environment };
}
