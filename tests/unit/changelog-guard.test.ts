import { describe, expect, it } from "vitest";
import { changelogCheck, userFacingChanges } from "../../scripts/check-changelog.mjs";

describe("changelog guard", () => {
  it("treats app, component, lib, and public changes as user-facing, but not tests or observability", () => {
    expect(userFacingChanges([
      "app/chat/page.tsx",
      "components/account-menu.tsx",
      "lib/changelog.ts",
      "public/logo.svg",
      "lib/observability/logger.ts",
      "lib/foo.test.ts",
      "tests/unit/changelog-guard.test.ts",
      "docs/releases/README.md",
      ".github/workflows/pr-guard.yml",
      "",
    ])).toEqual(["app/chat/page.tsx", "components/account-menu.tsx", "lib/changelog.ts", "public/logo.svg"]);
  });

  it("fails user-facing changes without a CHANGELOG.md update", () => {
    const result = changelogCheck(["components/account-menu.tsx"]);
    expect(result.problems[0]).toMatch(/CHANGELOG\.md was not updated/);
    expect(result.problems).toContain("  components/account-menu.tsx");
  });

  it("passes when CHANGELOG.md changed, nothing user-facing changed, or the no-changelog label is set", () => {
    expect(changelogCheck(["components/account-menu.tsx", "CHANGELOG.md"]).problems).toEqual([]);
    expect(changelogCheck(["docs/releases/README.md", "tests/unit/x.test.ts"]).problems).toEqual([]);
    expect(changelogCheck(["components/account-menu.tsx"], { skip: true }).problems).toEqual([]);
  });
});
