import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";
const npm = isWindows ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
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
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

function parseEnv(text) {
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

console.log("\n[Nibie] Starting local Supabase...");
run(npx, ["--yes", "supabase@latest", "start"]);

console.log("\n[Nibie] Reading local Supabase connection...");
const localEnv = parseEnv(
  capture(npx, [
    "--yes",
    "supabase@latest",
    "status",
    "--env",
    "--output-format",
    "text",
    "--override-name",
    "API_URL=NEXT_PUBLIC_SUPABASE_URL,PUBLISHABLE_KEY=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,DB_URL=DATABASE_URL",
  ]),
);

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
];

for (const key of required) {
  if (!localEnv[key]) {
    console.error(`[Nibie] Missing local Supabase value: ${key}`);
    process.exit(1);
  }
}

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
