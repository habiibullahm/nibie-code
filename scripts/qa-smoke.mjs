import env from "@next/env";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
    "test",
    "tests/e2e/qa-smoke.spec.ts",
    "--workers=1",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
