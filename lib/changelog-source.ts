import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog, getLatestShippedReleasePreview } from "@/lib/changelog";

export function loadChangelog() {
  return parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
}

export function loadLatestShippedReleasePreview() {
  try {
    return getLatestShippedReleasePreview(loadChangelog());
  } catch {
    return null;
  }
}
