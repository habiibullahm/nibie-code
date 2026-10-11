import env from "@next/env";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function qaSmokeArgs(argv) {
  const settingsOnly = argv.includes("--settings");
  return [
    "test",
    settingsOnly ? "tests/e2e/settings-preview.spec.ts" : "tests/e2e/qa-smoke.spec.ts",
    "--workers=1",
    ...argv.filter((argument) => argument !== "--settings"),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  env.loadEnvConfig(process.cwd());
  const missing = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD"].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`QA preview smoke requires: ${missing.join(", ")}`);
    console.error("Set them in the runtime environment or secret store. Do not commit credentials.");
    process.exit(1);
  }
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)),
      ...qaSmokeArgs(process.argv.slice(2)),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
