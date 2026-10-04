import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredPaths = [
  "CHANGELOG.md",
  "docs/releases/README.md",
  "docs/releases/V1_RELEASE_TEMPLATE.md",
  "docs/releases/V1_RELEASE_CHECKLIST.md",
  "docs/engineering/OBSERVABILITY.md",
  "lib/observability/release.ts",
  "lib/observability/logger.ts",
];

const skipDirectories = new Set(["node_modules", ".next", ".git", "coverage", "playwright-report", "test-results", ".vitest"]);
const skipFiles = new Set(["package-lock.json"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".md", ".sql", ".json", ".css"]);

export function duplicateMigrationPrefixes(filenames) {
  const groups = new Map();
  for (const name of filenames) {
    const match = /^(\d+)_/.exec(name);
    if (!match) continue;
    const numeric = String(Number(match[1]));
    if (!groups.has(numeric)) groups.set(numeric, { prefix: match[1], files: [] });
    groups.get(numeric).files.push(name);
  }
  return [...groups.values()]
    .filter((group) => group.files.length > 1)
    .map((group) => ({ prefix: group.prefix, files: [...group.files].sort() }));
}

export function journalProblems(sqlFiles, journal) {
  const problems = [];
  if (!journal || !Array.isArray(journal.entries)) return ["migration journal is missing entries"];
  const tags = [];
  const seen = new Set();
  journal.entries.forEach((entry, index) => {
    tags.push(entry.tag);
    if (entry.idx !== index) problems.push(`journal idx ${entry.idx} is not sequential at position ${index}`);
    if (typeof entry.tag !== "string" || !entry.tag) problems.push(`journal entry ${index} is missing a tag`);
    if (seen.has(entry.tag)) problems.push(`journal tag ${entry.tag} is duplicated`);
    seen.add(entry.tag);
  });
  const sqlNames = sqlFiles.filter((name) => name.endsWith(".sql")).map((name) => name.slice(0, -4));
  for (const tag of tags) {
    if (tag && !sqlNames.includes(tag)) problems.push(`journal tag ${tag} has no matching sql file`);
  }
  for (const name of sqlNames) {
    if (!tags.includes(name)) problems.push(`sql file ${name}.sql is missing from the migration journal`);
  }
  return problems;
}

export function textHasMergeMarker(text) {
  return /^<{7} /m.test(text) || /^>{7} /m.test(text);
}

function snapshotProblems(root, journal) {
  const problems = [];
  for (const entry of journal.entries) {
    if (typeof entry.idx !== "number") continue;
    const name = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    if (!existsSync(join(root, "drizzle", "meta", name))) problems.push(`missing drizzle/meta/${name}`);
  }
  return problems;
}

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skipDirectories.has(entry.name) || skipFiles.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (textExtensions.has(extensionOf(entry.name)) && statSync(path).size <= 262_144) files.push(path);
  }
}

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function gitPorcelain(root) {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function readRoot() {
  const index = process.argv.indexOf("--root");
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function checkRelease(root) {
  const problems = [];
  const drizzleDir = join(root, "drizzle");
  const sqlFiles = existsSync(drizzleDir) ? readdirSync(drizzleDir).filter((name) => name.endsWith(".sql") && statSync(join(drizzleDir, name)).isFile()) : [];
  if (!sqlFiles.length) problems.push("no drizzle sql migrations found");
  for (const duplicate of duplicateMigrationPrefixes(sqlFiles)) {
    problems.push(`duplicate migration prefix ${duplicate.prefix}: ${duplicate.files.join(", ")}`);
  }

  const journalPath = join(root, "drizzle", "meta", "_journal.json");
  if (!existsSync(journalPath)) problems.push("drizzle/meta/_journal.json is missing");
  else {
    let journal;
    try {
      journal = JSON.parse(readFileSync(journalPath, "utf8"));
    } catch {
      problems.push("drizzle/meta/_journal.json is not valid JSON");
    }
    if (journal) {
      problems.push(...journalProblems(sqlFiles, journal));
      if (Array.isArray(journal.entries)) problems.push(...snapshotProblems(root, journal));
    }
  }

  for (const required of requiredPaths) {
    if (!existsSync(join(root, required))) problems.push(`missing ${required}`);
  }
  const releaseHelper = join(root, "lib", "observability", "release.ts");
  if (existsSync(releaseHelper) && !readFileSync(releaseHelper, "utf8").includes("export function readReleaseIdentity")) {
    problems.push("lib/observability/release.ts does not export readReleaseIdentity");
  }

  if (existsSync(root)) {
    const files = [];
    walk(root, files);
    for (const file of files) {
      if (textHasMergeMarker(readFileSync(file, "utf8"))) problems.push(`unresolved merge marker in ${relative(root, file)}`);
    }
  }

  return problems;
}

function main() {
  const root = readRoot();
  const problems = checkRelease(root);
  const requireClean = process.argv.includes("--require-clean");
  const dirty = gitPorcelain(root);
  if (dirty === null) {
    if (requireClean) problems.push("git metadata is unavailable and --require-clean was set");
  } else if (dirty) {
    const message = "git working tree is dirty";
    if (requireClean) problems.push(message);
    else console.log(`${message}; continuing. Re-run with --require-clean when freezing a release SHA.`);
  }

  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log("release check passed");
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
