import { describe, expect, it } from "vitest";
import { getCurrentDevelopmentPreview, getLatestShippedReleasePreview, parseChangelog } from "../../lib/changelog";

const markdown = `# Changelog

What's new in Nibie.

## Unreleased

### Added

- A draft feature that has not shipped.

## 1.0.0

October 6, 2026

### Added

- Attach files directly to a chat.
- Weekly AI usage allowance.

### Changed

- Better response formatting.

### Fixed

- More reliable Stop behavior.

### Known issues

- Scanned PDFs are not supported yet.

## Current development

### Workspace

- Rooms keep their own threads.
- Pins stay with each Room.

### Account

- Settings cover language and the model.
`;

describe("changelog-derived previews", () => {
  it("selects version, date, and four highlights from the newest shipped release only", () => {
    const preview = getLatestShippedReleasePreview(parseChangelog(markdown));
    expect(preview).toEqual({
      version: "v1.0.0",
      date: "October 6, 2026",
      highlights: [
        "Attach files directly to a chat.",
        "Weekly AI usage allowance.",
        "Better response formatting.",
        "More reliable Stop behavior.",
      ],
    });
  });

  it("removes Markdown delimiters from preview highlights without changing their wording", () => {
    const document = parseChangelog(`# Changelog\n\n## 1.0.0\n\nOctober 6, 2026\n\n### Added\n\n- Use \`+ button\` and **Markdown** in a [chat](https://example.com).\n`);
    expect(getLatestShippedReleasePreview(document)?.highlights).toEqual(["Use + button and Markdown in a chat."]);
  });

  it("returns no release preview when CHANGELOG.md has no shipped version", () => {
    const document = parseChangelog(`# Changelog\n\n## Unreleased\n\n### Added\n\n- Draft only.\n\n## Current development\n\n### Workspace\n\n- A current capability.\n`);
    expect(getLatestShippedReleasePreview(document)).toBeNull();
  });

  it("derives the existing landing highlights from Current development", () => {
    expect(getCurrentDevelopmentPreview(parseChangelog(markdown))).toEqual([
      "Rooms keep their own threads.",
      "Pins stay with each Room.",
      "Settings cover language and the model.",
    ]);
  });
});
