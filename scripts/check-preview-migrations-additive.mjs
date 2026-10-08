#!/usr/bin/env node
/**
 * Gate for Preview App DB Migration against the shared production Postgres.
 *
 * Prefer an isolated Preview database. Until then, refuse PR migrations that look
 * destructive so unreviewed DROP/TRUNCATE/DELETE cannot reach production.
 *
 * Compares drizzle/*.sql against origin/main when available; otherwise scans all
 * SQL files in the working tree.
 *
 * Shared DB *writes* are separately gated by PR label `allow-shared-db-migrate`
 * or workflow_dispatch in preview-app-db-migration.yml.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SHARED_DB_MIGRATE_LABEL = "allow-shared-db-migrate";

export const FORBIDDEN = [
  { name: "DROP TABLE", re: /\bdrop\s+table\b/i },
  { name: "DROP COLUMN", re: /\bdrop\s+column\b/i },
  { name: "TRUNCATE", re: /\btruncate\b/i },
  { name: "DELETE FROM", re: /\bdelete\s+from\b/i },
  { name: "ALTER TYPE … DROP", re: /\balter\s+type\b[\s\S]{0,80}\bdrop\b/i },
  { name: "DROP SCHEMA", re: /\bdrop\s+schema\b/i },
];

/** @param {string} sql */
export function findForbiddenPatterns(sql) {
  /** @type {string[]} */
  const hits = [];
  for (const rule of FORBIDDEN) {
    if (rule.re.test(sql)) hits.push(rule.name);
  }
  return hits;
}

/**
 * @param {string} root
 * @param {{ changedNames?: string[] | null }} [opts]
 * `changedNames: []` = diff known, zero SQL changes (pass without scanning history).
 * `changedNames: null` / unresolved git diff = scan all drizzle SQL (fail closed on forbidden patterns).
 */
export function checkAdditiveMigrations(root, opts = {}) {
  const drizzleDir = join(root, "drizzle");
  const changed = opts.changedNames !== undefined ? opts.changedNames : filesChangedVsMain(root);
  /** @type {string[]} */
  let targets;
  /** @type {"vs_main" | "vs_main_empty" | "all_files"} */
  let mode;
  if (changed === null) {
    targets = readdirSync(drizzleDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    mode = "all_files";
  } else if (changed.length === 0) {
    targets = [];
    mode = "vs_main_empty";
  } else {
    targets = changed;
    mode = "vs_main";
  }
  /** @type {string[]} */
  const problems = [];

  for (const name of targets) {
    const path = join(drizzleDir, name);
    if (!existsSync(path)) {
      problems.push(`${name}: missing on disk`);
      continue;
    }
    const sql = readFileSync(path, "utf8");
    for (const hit of findForbiddenPatterns(sql)) {
      problems.push(`${name}: forbidden pattern ${hit}`);
    }
  }

  return {
    targets,
    mode,
    comparedToMain: mode === "vs_main" || mode === "vs_main_empty",
    problems,
  };
}

/** @param {string} root */
function filesChangedVsMain(root) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD", "--", "drizzle/*.sql"], {
      cwd: root,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".sql"))
      .map((line) => line.replace(/^drizzle\//, ""));
  } catch {
    return null;
  }
}

function main() {
  const root = process.cwd();
  const result = checkAdditiveMigrations(root);
  if (result.problems.length) {
    console.error("::error::Preview migrations must be strictly additive against the shared app DB.");
    for (const problem of result.problems) console.error(`::error::${problem}`);
    console.error(
      "::error::Apply schema changes via the Production DB Migration workflow on main, or use an isolated Preview database.",
    );
    process.exit(1);
  }

  if (result.mode === "vs_main_empty") {
    console.log("additive check ok (no new/changed drizzle SQL vs origin/main)");
  } else if (result.mode === "vs_main") {
    console.log(`additive check ok (${result.targets.length} new/changed drizzle SQL vs origin/main)`);
  } else {
    console.log(`additive check ok (scanned ${result.targets.length} drizzle SQL files)`);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("check-preview-migrations-additive.mjs") ||
    process.argv[1].includes("check-preview-migrations-additive"));

if (isDirectRun) main();
