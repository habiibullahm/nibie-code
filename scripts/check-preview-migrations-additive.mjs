#!/usr/bin/env node
/**
 * Gate for Preview App DB Migration against the shared production Postgres.
 *
 * Prefer an isolated Preview database. Until then, refuse PR migrations that look
 * destructive so unreviewed DROP/TRUNCATE/DELETE cannot reach production.
 *
 * Compares drizzle/*.sql against origin/main when available; otherwise scans all
 * SQL files in the working tree.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const drizzleDir = join(root, "drizzle");

const FORBIDDEN = [
  { name: "DROP TABLE", re: /\bdrop\s+table\b/i },
  { name: "DROP COLUMN", re: /\bdrop\s+column\b/i },
  { name: "TRUNCATE", re: /\btruncate\b/i },
  { name: "DELETE FROM", re: /\bdelete\s+from\b/i },
  { name: "ALTER TYPE … DROP", re: /\balter\s+type\b[\s\S]{0,80}\bdrop\b/i },
  { name: "DROP SCHEMA", re: /\bdrop\s+schema\b/i },
];

function listSqlFiles() {
  return readdirSync(drizzleDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function filesChangedVsMain() {
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

const changed = filesChangedVsMain();
const targets = changed && changed.length ? changed : listSqlFiles();
const problems = [];

for (const name of targets) {
  const path = join(drizzleDir, name);
  if (!existsSync(path)) {
    problems.push(`${name}: missing on disk`);
    continue;
  }
  const sql = readFileSync(path, "utf8");
  for (const rule of FORBIDDEN) {
    if (rule.re.test(sql)) problems.push(`${name}: forbidden pattern ${rule.name}`);
  }
}

if (problems.length) {
  console.error("::error::Preview migrations must be strictly additive against the shared app DB.");
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error("::error::Apply schema changes via the Production DB Migration workflow on main, or use an isolated Preview database.");
  process.exit(1);
}

console.log(
  changed && changed.length
    ? `additive check ok (${changed.length} new/changed drizzle SQL vs origin/main)`
    : `additive check ok (scanned ${targets.length} drizzle SQL files)`,
);
