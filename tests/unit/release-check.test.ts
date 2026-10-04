import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { duplicateMigrationPrefixes, textHasMergeMarker } from "../../scripts/check-release.mjs";

function runCheck(args: string[]) {
  return spawnSync(process.execPath, ["scripts/check-release.mjs", ...args], { encoding: "utf8", cwd: process.cwd() });
}

describe("release checker", () => {
  it("flags duplicate numeric migration prefixes", () => {
    expect(duplicateMigrationPrefixes(["0005_pins.sql", "0005_room_files.sql", "0006_workbench.sql"])).toEqual([
      { prefix: "0005", files: ["0005_pins.sql", "0005_room_files.sql"] },
    ]);
    expect(duplicateMigrationPrefixes(["0004_rooms.sql", "0005_superb_frank_castle.sql"])).toEqual([]);
  });

  it("detects unresolved merge markers", () => {
    expect(textHasMergeMarker("clean\n")).toBe(false);
    expect(textHasMergeMarker("<<<<<<< feature\n")).toBe(true);
  });

  it("passes the repository migration inventory", () => {
    const result = runCheck([]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("release check passed");
  }, 30_000);

  it("fails a tree that repeats migration 0005", () => {
    const root = mkdtempSync(join(tmpdir(), "nibie-release-"));
    mkdirSync(join(root, "drizzle", "meta"), { recursive: true });
    mkdirSync(join(root, "docs", "releases"), { recursive: true });
    mkdirSync(join(root, "docs", "engineering"), { recursive: true });
    mkdirSync(join(root, "lib", "observability"), { recursive: true });
    writeFileSync(join(root, "drizzle", "0005_pins.sql"), "-- pins\n");
    writeFileSync(join(root, "drizzle", "0005_room_files.sql"), "-- files\n");
    writeFileSync(join(root, "drizzle", "meta", "_journal.json"), JSON.stringify({
      entries: [
        { idx: 0, tag: "0005_pins" },
        { idx: 1, tag: "0005_room_files" },
      ],
    }));
    writeFileSync(join(root, "drizzle", "meta", "0000_snapshot.json"), "{}\n");
    writeFileSync(join(root, "drizzle", "meta", "0001_snapshot.json"), "{}\n");
    const files = [
      ["CHANGELOG.md", "# Changelog\n"],
      ["docs/releases/README.md", "# Releases\n"],
      ["docs/releases/V1_RELEASE_TEMPLATE.md", "# Template\n"],
      ["docs/releases/V1_RELEASE_CHECKLIST.md", "# Checklist\n"],
      ["docs/engineering/OBSERVABILITY.md", "# Observability\n"],
      ["lib/observability/logger.ts", "export {}\n"],
      ["lib/observability/release.ts", "export function readReleaseIdentity() { return null; }\n"],
    ] as const;
    for (const [path, body] of files) writeFileSync(join(root, path), body);

    const result = runCheck(["--root", root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("duplicate migration prefix 0005: 0005_pins.sql, 0005_room_files.sql");
  });
});
