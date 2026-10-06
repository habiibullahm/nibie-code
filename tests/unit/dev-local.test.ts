import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localEnvFromStatus, parseEnv, SUPABASE_CLI } from "../../scripts/dev-local.mjs";

// Shape of `supabase status -o env` from the pinned CLI. Values are placeholders.
const status = [
  "ANON_KEY=anon-placeholder",
  'API_URL="http://127.0.0.1:54321"',
  'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
  "JWT_SECRET=jwt-placeholder",
  "PUBLISHABLE_KEY=publishable-placeholder",
  "SECRET_KEY=secret-placeholder",
  'STUDIO_URL="http://127.0.0.1:54323"',
].join("\n");

describe("dev:local script", () => {
  it("pins the Supabase CLI to an exact version", () => {
    expect(SUPABASE_CLI).toMatch(/^supabase@\d+\.\d+\.\d+$/);
  });

  it("parses quoted, unquoted, comment and blank lines, including Windows line endings", () => {
    expect(parseEnv('# note\r\nA=1\r\n\r\nB="two words"\r\nC=\'3\'\r\nURL="postgres://u:p@h/db?x=1"')).toEqual({
      A: "1", B: "two words", C: "3", URL: "postgres://u:p@h/db?x=1",
    });
  });

  it("maps the CLI's status names to the variables the app reads", () => {
    expect(localEnvFromStatus(status)).toEqual({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-placeholder",
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      },
      missing: [],
    });
  });

  it("names every value the status output did not provide", () => {
    expect(localEnvFromStatus('API_URL="http://127.0.0.1:54321"').missing).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL"]);
  });

  it("loads Next env through its CommonJS default export under Node ESM", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "dev-local.mjs"), "utf8");
    expect(source).toContain('import nextEnv from "@next/env";');
    expect(source).toContain("const { loadEnvConfig } = nextEnv;");
  });

  it("loads under plain Node ESM, where a named import from the CommonJS @next/env fails", () => {
    // Vitest resolves CommonJS named imports leniently, so only a real Node process proves the script can start.
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./scripts/dev-local.mjs")'], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.stderr).not.toMatch(/Named export 'loadEnvConfig' not found/);
    expect(result.status).toBe(0);
  });

  it("runs Windows .cmd launchers through a shell and avoids the removed status flags", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "dev-local.mjs"), "utf8");
    expect(source).toContain("const shell = isWindows;");
    expect(source).not.toContain("shell: false");
    expect(source).not.toContain('"--env"');
    expect(source).not.toContain("--override-name");
    expect(source).not.toContain("supabase@latest");
  });
});
