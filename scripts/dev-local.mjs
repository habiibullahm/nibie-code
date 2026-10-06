import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";
const npm = isWindows ? "npm.cmd" : "npm";

// Pinned so a new CLI release cannot change the `status` output this script reads. Bump it on purpose and re-run `npm run dev:local`.
export const SUPABASE_CLI = "supabase@2.119.0";

// Node refuses to run .cmd files (npx.cmd, npm.cmd) without a shell, so Windows needs one. Every argument here is a fixed
// word, with no spaces or user input, so the shell adds no quoting risk.
const shell = isWindows;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell,
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

export function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index);
        let value = line.slice(index + 1);
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

// `supabase status -o env` prints the CLI's own names. The app reads these three.
export function localEnvFromStatus(text) {
  const status = parseEnv(text);
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    DATABASE_URL: status.DB_URL,
  };
  const missing = Object.keys(env).filter((key) => !env[key]);
  return { env, missing };
}

function main() {
  // Load .env.local before spawning child processes so provider secrets are available to the local app. The local Supabase
  // connection values below still override any hosted ones it contains.
  loadEnvConfig(process.cwd());
  console.log("\n[Nibie] Local env loaded:", {
    fast: Boolean(process.env.SUMOPOD_API_KEY && process.env.SUMOPOD_BASE_URL),
    openai: Boolean(process.env.OPENAI_API_KEY),
  });

  console.log("\n[Nibie] Starting local Supabase...");
  run(npx, ["--yes", SUPABASE_CLI, "start"]);

  console.log("\n[Nibie] Reading local Supabase connection...");
  const { env: localEnv, missing } = localEnvFromStatus(
    capture(npx, ["--yes", SUPABASE_CLI, "status", "-o", "env"]),
  );

  for (const key of missing) {
    console.error(`[Nibie] Missing local Supabase value: ${key}`);
  }
  if (missing.length) process.exit(1);

  const env = {
    ...process.env,
    ...localEnv,
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  };

  console.log("\n[Nibie] Applying Drizzle migrations to local Supabase...");
  run(npm, ["run", "db:migrate"], { env });

  console.log("\n[Nibie] Local stack ready:");
  console.log(`  App:      http://localhost:3000`);
  console.log(`  Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log("\n[Nibie] Starting Next.js...\n");

  run(npm, ["run", "dev"], { env });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
