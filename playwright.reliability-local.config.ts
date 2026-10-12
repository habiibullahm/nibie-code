import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const directory = process.env.NIBIE_LOCAL_QA_DIRECTORY;
if (!directory || !path.isAbsolute(directory)) throw new Error("Isolated QA setup directory required.");
const credentials = JSON.parse(fs.readFileSync(path.join(directory, "credentials.json"), "utf8")) as {
 api: string; db: string; publicKey: string; serviceKey: string; email: string; password: string; userId: string;
};
const api = new URL(credentials.api);
const db = new URL(credentials.db);
if (!["localhost", "127.0.0.1"].includes(api.hostname) || api.protocol !== "http:" || api.port !== "54621" ||
 !["localhost", "127.0.0.1"].includes(db.hostname) || db.protocol !== "postgresql:" || db.port !== "54622") {
 throw new Error("This profile rejects non-isolated database/auth targets.");
}
if (process.env.E2E_BASE_URL?.trim()) throw new Error("Use the Playwright-managed localhost:3100 server.");
const env = {
 ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined)),
 NODE_EXTRA_CA_CERTS: path.join(directory,"trusted-ca.pem"),
 NEXT_PUBLIC_APP_URL: "http://localhost:3100",
 NEXT_PUBLIC_SUPABASE_URL: credentials.api,
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.publicKey,
 NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.publicKey,
 SUPABASE_SERVICE_ROLE_KEY: credentials.serviceKey,
 DATABASE_URL: credentials.db,
 OPENAI_API_KEY: "nibie-local-qa-only",
 OPENAI_BASE_URL: "https://localhost:54625/v1",
 OPENAI_MODEL_BALANCED: "qa-balanced",
 OPENAI_MODEL_HIGH: "qa-high",
 OPENAI_HIGH_REASONING_EFFORT: "high",
 OPENAI_BALANCED_REASONING_EFFORT: "medium",
 SUMOPOD_API_KEY: "nibie-local-qa-only",
 SUMOPOD_BASE_URL: "https://localhost:54625/v1",
 SUMOPOD_MODEL_FAST: "qa-fast",
 AI_API_KEY: "", AI_BASE_URL: "", TAVILY_API_KEY: "", WEB_SEARCH_PROVIDER: "",
 AI_SPEND_LIMIT_USER_DAILY_USD: "5", AI_SPEND_LIMIT_GLOBAL_HOURLY_USD: "50",
 WORKBENCH_UI_ENABLED: "false", CI: "1",
};
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export default defineConfig({
 testDir: "./tests/reliability-local", workers: 1,
 use: { ...devices["Desktop Chrome"], baseURL:"http://localhost:3100", trace:"off" },
 webServer: [
  { command:"node "+quote(path.resolve("scripts/reliability-local/api-proxy.mjs")), url:"http://localhost:54621/auth/v1/health", env, reuseExistingServer:false },
  { command:"node "+quote(path.resolve("scripts/reliability-local/provider.mjs")), url:"https://localhost:54625/health", env, reuseExistingServer:false },
  { command:"npm run dev -- --port 3100", url:"http://localhost:3100", env, reuseExistingServer:false },
 ],
});
