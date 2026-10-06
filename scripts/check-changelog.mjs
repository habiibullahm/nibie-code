import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A PR that changes what users can see or do must add a CHANGELOG.md entry under "## Unreleased".
// Purely internal PRs opt out with the `no-changelog` label (passed in as SKIP_CHANGELOG=true).

export const changelogFile = "CHANGELOG.md";
const userFacingPrefixes = ["app/", "components/", "lib/", "public/"];
const internalPrefixes = ["lib/observability/"];
const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export function userFacingChanges(files) {
  return files
    .map((file) => file.trim().replace(/\\/g, "/"))
    .filter((file) => file
      && userFacingPrefixes.some((prefix) => file.startsWith(prefix))
      && !internalPrefixes.some((prefix) => file.startsWith(prefix))
      && !testFilePattern.test(file));
}

export function changelogCheck(files, { skip = false } = {}) {
  const userFacing = userFacingChanges(files);
  const updated = files.some((file) => file.trim().replace(/\\/g, "/") === changelogFile);
  const problems = !skip && userFacing.length && !updated
    ? [`${changelogFile} was not updated, but these user-facing files changed:`, ...userFacing.map((file) => `  ${file}`)]
    : [];
  return { userFacing, updated, problems };
}

function readBase() {
  const index = process.argv.indexOf("--base");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const base = readBase();
  if (!base) {
    console.error("usage: node scripts/check-changelog.mjs --base <git-ref>");
    process.exit(2);
  }
  const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" });
  if (diff.error || diff.status !== 0) {
    console.error(`git diff against ${base} failed: ${diff.error?.message ?? diff.stderr.trim()}`);
    process.exit(2);
  }

  const skip = process.env.SKIP_CHANGELOG === "true";
  const { userFacing, updated, problems } = changelogCheck(diff.stdout.split("\n"), { skip });
  if (problems.length) {
    for (const line of problems) console.error(line);
    console.error(`\nAdd a short, user-facing line under "## Unreleased" in ${changelogFile}.`);
    console.error("If nothing users can see or do changed, add the `no-changelog` label to the pull request.");
    process.exit(1);
  }

  if (skip && userFacing.length && !updated) console.log("changelog check skipped by the no-changelog label");
  else if (!userFacing.length) console.log("no user-facing files changed; changelog not required");
  else console.log("changelog check passed");
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
