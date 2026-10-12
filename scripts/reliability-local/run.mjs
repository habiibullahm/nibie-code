import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// Only newly created, uniquely named, loopback-bound resources belong to this run.
// Existing Supabase projects, remote databases and actual providers are never used.
const scripts = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(scripts, "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nibie-chat-qa-"));
fs.chmodSync(directory, 0o700);
const project = "nibie-chat-qa-" + randomBytes(6).toString("hex");
const env = { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" };
for (const name of ["DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete env[name];
for (const name of ["DATABASE_URL", "TEST_DATABASE_URL", "ALLOW_TEST_DATABASE_RESET", "E2E_BASE_URL",
  "E2E_USER_EMAIL", "E2E_USER_PASSWORD", "OPENAI_API_KEY", "SUMOPOD_API_KEY", "AI_API_KEY",
  "TAVILY_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "WEB_SEARCH_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "GH_TOKEN", "GITHUB_TOKEN", "VERCEL_TOKEN", "VERCEL_OIDC_TOKEN"]) env[name] = "";
const secrets = [];
function redact(value) {
  for (const secret of secrets) value = value.split(secret).join("[local-fixture-redacted]");
  return value;
}
function command(program, args) {
  const result = spawnSync(program, args, { cwd: directory, env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(program + " failed: " + redact((result.stderr || "Tool unavailable or command unsuccessful").slice(-2000)));
  }
  return result.stdout.trim();
}
const docker = (...args) => command("docker", ["--host=unix:///var/run/docker.sock", ...args]);
const compose = (...args) => docker("compose", "-p", project, "-f", path.join(directory, "compose.yaml"), ...args);
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error("Required local QA port is occupied: " + port)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function ready(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* Wait for the new local service. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Isolated auth service did not become healthy.");
}
const baseline = new Set();
let started = false;
let child;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  child?.kill(signal);
});
let exitCode = 1;
try {
  if (process.versions.node.split(".")[0] !== "22") throw new Error("Activate Node.js 22 before running local QA.");
  for (const port of [3100, 54621, 54622, 54625, 54626, 54627]) await freePort(port);
  for (const id of docker("ps", "-aq").split("\n").filter(Boolean)) baseline.add(id);
  fs.copyFileSync(path.join(scripts, "compose.yaml"), path.join(directory, "compose.yaml"));
  const password = randomBytes(24).toString("hex");
  const jwtSecret = randomBytes(32).toString("hex");
  secrets.push(password, jwtSecret);
  fs.writeFileSync(path.join(directory, "local.env"), [
    "POSTGRES_PASSWORD=" + password, "GOTRUE_JWT_SECRET=" + jwtSecret, "PGRST_JWT_SECRET=" + jwtSecret,
    "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:" + password + "@db:5432/postgres",
    "PGRST_DB_URI=postgres://authenticator:" + password + "@db:5432/postgres",
  ].join("\n") + "\n", { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "init.sql"), `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password '${password}';
grant anon,authenticated,service_role to authenticator;
create role supabase_auth_admin login password '${password}';
alter role supabase_auth_admin set search_path to auth;
create schema auth authorization supabase_auth_admin;
grant usage on schema auth,public to anon,authenticated,service_role;
grant all on schema public to postgres,service_role;
alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;
`, { mode: 0o644 }); // Bind-mounted initializer must be readable by PostgreSQL; parent is private.
  fs.chmodSync(path.join(directory, "init.sql"), 0o644);
  command("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
    "-keyout", "gateway-key.pem", "-out", "gateway-cert.pem", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
  fs.chmodSync(path.join(directory, "gateway-key.pem"), 0o600);
  const inheritedCA = process.env.NODE_EXTRA_CA_CERTS;
  fs.writeFileSync(path.join(directory, "trusted-ca.pem"),
    (inheritedCA ? fs.readFileSync(inheritedCA, "utf8") + "\n" : "") +
    fs.readFileSync(path.join(directory, "gateway-cert.pem"), "utf8"), { mode: 0o600 });
  // Never download or substitute image versions implicitly; see the documented prefetch step.
  console.log("Starting new isolated local auth/REST/database; provider traffic stays in the HTTPS simulator.");
  started = true;
  compose("up", "-d", "--pull", "never");
  await ready("http://127.0.0.1:54626/health");
  const db = "postgresql://postgres:" + password + "@127.0.0.1:54622/postgres";
  const sql = postgres(db, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: path.join(repo, "drizzle") });
    await sql`notify pgrst,'reload schema'`;
  } finally { await sql.end(); }
  const token = role => {
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const payload = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ iss: "supabase", aud: "authenticated",
      role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7200 });
    return payload + "." + createHmac("sha256", jwtSecret).update(payload).digest("base64url");
  };
  const publicKey = token("anon"), serviceKey = token("service_role");
  const email = "reliability-" + randomBytes(6).toString("hex") + "@nibie.test";
  const userPassword = randomBytes(24).toString("base64url");
  secrets.push(publicKey, serviceKey, email, userPassword);
  const response = await fetch("http://127.0.0.1:54626/admin/users", { method: "POST",
    headers: { authorization: "Bearer " + serviceKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password: userPassword, email_confirm: true }) });
  if (!response.ok) throw new Error("Disposable account creation failed: HTTP " + response.status);
  const user = await response.json();
  fs.writeFileSync(path.join(directory, "credentials.json"), JSON.stringify({
    api: "http://localhost:54621", db, publicKey, serviceKey, email, password: userPassword, userId: user.id,
  }), { mode: 0o600 });
  if (interrupted) throw new Error("QA interrupted before browser startup.");
  exitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(repo, "node_modules/@playwright/test/cli.js"), "test",
      "--config=playwright.reliability-local.config.ts", ...process.argv.slice(2)], {
      cwd: repo, env: { ...env, NIBIE_LOCAL_QA_DIRECTORY: directory,
        NODE_EXTRA_CA_CERTS: path.join(directory, "trusted-ca.pem") }, stdio: ["inherit", "pipe", "pipe"],
    });
    for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", chunk => {
        pending += chunk;
        const end = pending.lastIndexOf("\n");
        if (end >= 0) { output.write(redact(pending.slice(0, end + 1))); pending = pending.slice(end + 1); }
      });
      stream.on("end", () => { if (pending) output.write(redact(pending)); });
    }
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  if (started) {
    try { console.error(redact(compose("logs", "--no-color", "--tail", "12"))); } catch { /* Original failure is retained. */ }
  }
} finally {
  try {
    if (started) {
      const owned = docker("ps", "-aq", "--filter", "label=com.docker.compose.project=" + project).split("\n").filter(Boolean);
      if (owned.some(id => baseline.has(id))) throw new Error("Refusing cleanup of a pre-existing container.");
      compose("down", "-v");
      console.log("Removed only this run's local QA containers and volume.");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    console.error("Local QA cleanup failed: " + redact(error.message));
    exitCode = 1;
  }
}
process.exitCode = interrupted ? 1 : exitCode;
