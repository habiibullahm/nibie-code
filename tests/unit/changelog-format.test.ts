import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changelogProblems, getWhatsNewPreview, parseChangelog } from "../../lib/changelog";

const problems = (markdown: string) => changelogProblems(parseChangelog(markdown));

describe("CHANGELOG.md format", () => {
  it("the real changelog follows the format and feeds What's new", () => {
    const document = parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
    expect(changelogProblems(document)).toEqual([]);
    expect(getWhatsNewPreview(document)?.highlights.length).toBeGreaterThan(0);
  });

  it("accepts Unreleased, dated releases, and a free-form Current development snapshot", () => {
    expect(problems(`# Changelog\n\n## Unreleased\n\n### Added\n\n- Next.\n\n## v1.1.0\n\nOctober 6, 2026\n\n### Fixed\n\n- A fix.\n\n## 1.0.0\n\n2026-09-01\n\n### Added\n\n- First.\n\n## Current development\n\n### Workspace\n\n- Rooms.\n`)).toEqual([]);
  });

  it("requires Unreleased first", () => {
    expect(problems(`# Changelog\n\n## v1.0.0\n\nOctober 6, 2026\n\n### Added\n\n- First.\n`)).toContain("the first entry must be \"## Unreleased\"");
  });

  it("rejects releases without a readable date or with a non-version heading", () => {
    expect(problems(`# Changelog\n\n## Unreleased\n\n## v1.0.0\n\n### Added\n\n- First.\n`)).toContain("release \"v1.0.0\" is missing its date line");
    expect(problems(`# Changelog\n\n## Unreleased\n\n## v1.0.0\n\nsoon\n\n### Added\n\n- First.\n`)).toContain("release \"v1.0.0\" has an unreadable date \"soon\"");
    expect(problems(`# Changelog\n\n## Unreleased\n\n## Big launch\n\nOctober 6, 2026\n\n### Added\n\n- First.\n`)).toContain("\"Big launch\" is not a release version like 1.2.3 or v1.2.3");
  });

  it("rejects unknown groups, dated Unreleased, and duplicate versions", () => {
    expect(problems(`# Changelog\n\n## Unreleased\n\n### New stuff\n\n- Thing.\n`).join("\n")).toMatch(/unsupported group "New stuff"/);
    expect(problems(`# Changelog\n\n## Unreleased\n\nOctober 6, 2026\n\n### Added\n\n- Thing.\n`)).toContain("\"Unreleased\" must not have a date line");
    expect(problems(`# Changelog\n\n## Unreleased\n\n## v1.0.0\n\nOctober 6, 2026\n\n### Added\n\n- A.\n\n## 1.0.0\n\nOctober 1, 2026\n\n### Added\n\n- B.\n`)).toContain("duplicate entry \"1.0.0\"");
  });
});
