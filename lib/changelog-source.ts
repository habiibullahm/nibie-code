import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog, getWhatsNewPreview } from "@/lib/changelog";

export function loadChangelog() {
  return parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
}

export function loadWhatsNewPreview() {
  try {
    return getWhatsNewPreview(loadChangelog());
  } catch {
    return null;
  }
}
