import { describe, expect, it } from "vitest";
import { getCurrentDevelopmentPreview, getLatestShippedReleasePreview, getWhatsNewPreview, parseChangelog } from "../../lib/changelog";

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

  it("What's new prefers the newest shipped release and keys the New badge by its version", () => {
    expect(getWhatsNewPreview(parseChangelog(markdown))).toMatchObject({ kind: "release", seenKey: "v1.0.0", version: "v1.0.0", date: "October 6, 2026" });
  });

  it("What's new falls back to Unreleased highlights when nothing has shipped", () => {
    const unreleasedOnly = `# Changelog

## Unreleased

### Added

- One.
- Two.
- Three.

### Fixed

- Four.
- Five.

### Known issues

- Not a highlight.

## Current development

### Workspace

- Snapshot.
`;
    const preview = getWhatsNewPreview(parseChangelog(unreleasedOnly));
    expect(preview).toMatchObject({ kind: "unreleased", highlights: ["One.", "Two.", "Three.", "Four."] });
    expect(preview?.seenKey).toMatch(/^unreleased-[0-9a-z]+$/);
  });

  it("What's new seen key is stable for the same content and changes when Unreleased changes", () => {
    const base = `# Changelog

## Unreleased

### Added

- One.
`;
    const key = (text: string) => getWhatsNewPreview(parseChangelog(text))?.seenKey;
    expect(key(base)).toBe(key(base));
    expect(key(`${base}- Two.
`)).not.toBe(key(base));
  });

  it("What's new is empty only when there is neither a release nor an Unreleased highlight", () => {
    expect(getWhatsNewPreview(parseChangelog(`# Changelog

## Unreleased

### Known issues

- Only a limitation.
`))).toBeNull();
  });

  it("derives the existing landing highlights from Current development", () => {
    expect(getCurrentDevelopmentPreview(parseChangelog(markdown))).toEqual([
      "Rooms keep their own threads.",
      "Pins stay with each Room.",
      "Settings cover language and the model.",
    ]);
  });
});
