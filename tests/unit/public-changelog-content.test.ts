import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChangelog } from "../../lib/changelog";

const root = process.cwd();
const publicDocument = parseChangelog(readFileSync(join(root, "CHANGELOG.md"), "utf8"));
const publicItems = publicDocument.entries.flatMap((entry) => entry.groups.flatMap((group) => group.items));
const publicCopy = publicItems.join("\n");

describe("public changelog copy", () => {
  it("prioritizes changes users can notice", () => {
    expect(publicCopy).toMatch(/Attach up to three text-based files/i);
    expect(publicCopy).toMatch(/weekly.*allowance|weekly.*usage.*settings/i);
    expect(publicCopy).toMatch(/stopping a reply.*preserv/i);
    expect(publicCopy).toMatch(/answers are easier to scan/i);
    expect(publicCopy).toMatch(/organize conversations in Rooms/i);
    expect(publicCopy).toMatch(/message box/i);
  });

  it("keeps implementation and release-engineering details out of public entries", () => {
    const internalDetails = [
      /\bGET \/api\/health\b/i,
      /\bVercel\b/i,
      /\b\d{4}_[a-z\d_-]+\.sql\b/i,
      /\b(?:migration|RPC|row-level security)\b/i,
      /\b(?:npm run|pnpm run)\b/i,
      /\b(?:release:check|migration inventory|version policy|release checklist|rollback notes|hotfix steps)\b/i,
      /\b(?:structured server logs?|request ids?|requestId|operational codes?|observability)\b/i,
      /\b(?:integration test suite|import alias|repository mechanics|composer)\b/i,
      /\b(?:git commit|production SHA|branch name|merge marker|repository|deployment identity)\b/i,
      /\bCI\b/i,
      /github\.com\/habiibullahm\/nibie-code\/issues/i,
    ];

    for (const pattern of internalDetails) expect(publicCopy).not.toMatch(pattern);
  });

  it("keeps technical release details in the internal docs", () => {
    const releaseChecklist = readFileSync(join(root, "docs/releases/V1_RELEASE_CHECKLIST.md"), "utf8");
    const releaseGuide = readFileSync(join(root, "docs/releases/README.md"), "utf8");
    const observability = readFileSync(join(root, "docs/engineering/OBSERVABILITY.md"), "utf8");
    const attachments = readFileSync(join(root, "docs/feature/attachments/v1.md"), "utf8");
    const weeklyUsage = readFileSync(join(root, "docs/feature/weekly-usage/v1.md"), "utf8");

    expect(releaseGuide).toContain("npm run release:check");
    expect(releaseGuide).toContain("Version policy");
    expect(releaseChecklist).toContain("technical changes, migrations, verification");
    expect(observability).toContain("requestId");
    expect(attachments).toContain("drizzle/0009_chat_attachments.sql");
    expect(weeklyUsage).toContain("100 credits per UTC week");
  });
});
