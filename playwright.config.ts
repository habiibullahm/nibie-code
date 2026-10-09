import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const externalUrl = process.env.E2E_BASE_URL?.trim() || undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: externalUrl ?? "http://localhost:3100",
  },
  webServer: externalUrl ? undefined : {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
  },
});
