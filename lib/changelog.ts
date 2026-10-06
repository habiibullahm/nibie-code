export const changelogPath = "/changelog";

export type ChangelogGroup = {
  heading: string;
  items: string[];
};

export type ChangelogEntry = {
  version: string;
  date?: string;
  groups: ChangelogGroup[];
};

export type ChangelogDocument = {
  title: string;
  intro: string[];
  entries: ChangelogEntry[];
};

export type ChangelogReleasePreview = {
  version: string;
  date: string;
  highlights: string[];
};

// Help → What's new. A shipped release wins; until one exists, the Unreleased highlights are shown as in progress.
// seenKey changes whenever the shown content changes, so the New badge reappears.
export type WhatsNewPreview =
  | ({ kind: "release"; seenKey: string } & ChangelogReleasePreview)
  | { kind: "unreleased"; seenKey: string; highlights: string[] };

const nonReleaseHeadings = new Set(["unreleased", "current development"]);
const highlightGroupHeadings = new Set(["added", "changed", "fixed", "removed", "deprecated"]);
export const changelogGroupHeadings = ["Added", "Changed", "Fixed", "Removed", "Deprecated", "Security", "Known issues"];
const releaseVersionPattern = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const previewHighlightLimit = 4;

function previewText(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

export function getLatestShippedReleasePreview(document: ChangelogDocument): ChangelogReleasePreview | null {
  const entry = document.entries.find((item) => {
    const heading = item.version.trim().toLowerCase();
    return heading.length > 0 && !nonReleaseHeadings.has(heading) && Boolean(item.date?.trim());
  });
  const date = entry?.date?.trim();
  if (!entry || !date) return null;

  const version = entry.version.trim();
  const highlights = entryHighlights(entry).slice(0, previewHighlightLimit);

  return { version: /^v/i.test(version) ? version : `v${version}`, date, highlights };
}

function entryHighlights(entry: ChangelogEntry) {
  return entry.groups
    .filter((group) => highlightGroupHeadings.has(group.heading.trim().toLowerCase()))
    .flatMap((group) => group.items)
    .filter((item) => item.trim() && item.trim().toLowerCase() !== "none.")
    .map(previewText);
}

// FNV-1a: a short, stable fingerprint that is identical on server and client.
function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function getWhatsNewPreview(document: ChangelogDocument): WhatsNewPreview | null {
  const release = getLatestShippedReleasePreview(document);
  if (release) return { kind: "release", seenKey: release.version, ...release };

  const unreleased = document.entries.find((item) => item.version.trim().toLowerCase() === "unreleased");
  const all = unreleased ? entryHighlights(unreleased) : [];
  if (!all.length) return null;
  return { kind: "unreleased", seenKey: `unreleased-${fingerprint(all.join("\n"))}`, highlights: all.slice(0, previewHighlightLimit) };
}

// Format rules for CHANGELOG.md. Unit tests run this against the real file so a malformed entry fails CI.
export function changelogProblems(document: ChangelogDocument): string[] {
  const problems: string[] = [];
  const allowedGroups = new Set(changelogGroupHeadings.map((heading) => heading.toLowerCase()));
  const seen = new Set<string>();

  if (document.entries[0]?.version.trim().toLowerCase() !== "unreleased") problems.push("the first entry must be \"## Unreleased\"");

  for (const entry of document.entries) {
    const version = entry.version.trim();
    const key = version.toLowerCase().replace(/^v/, "");
    if (seen.has(key)) problems.push(`duplicate entry "${version}"`);
    seen.add(key);

    if (key === "current development") {
      if (entry.date) problems.push(`"${version}" must not have a date line`);
      continue;
    }

    for (const group of entry.groups) {
      if (!allowedGroups.has(group.heading.trim().toLowerCase())) problems.push(`"${version}" has unsupported group "${group.heading}"; use ${changelogGroupHeadings.join(", ")}`);
    }

    if (key === "unreleased") {
      if (entry.date) problems.push(`"${version}" must not have a date line`);
      continue;
    }

    if (!releaseVersionPattern.test(version)) problems.push(`"${version}" is not a release version like 1.2.3 or v1.2.3`);
    if (!entry.date) problems.push(`release "${version}" is missing its date line`);
    else if (Number.isNaN(Date.parse(entry.date))) problems.push(`release "${version}" has an unreadable date "${entry.date}"`);
    if (!entry.groups.length) problems.push(`release "${version}" has no items`);
  }

  return problems;
}

export function getCurrentDevelopmentPreview(document: ChangelogDocument): string[] {
  const entry = document.entries.find((item) => item.version.trim().toLowerCase() === "current development");
  if (!entry) return [];
  const firstItems = (heading: string, count: number) => entry.groups
    .find((group) => group.heading.trim().toLowerCase() === heading.toLowerCase())
    ?.items.slice(0, count) ?? [];
  const selected = [...firstItems("Workspace", 2), ...firstItems("Account", 1)];
  return selected.length ? selected : entry.groups.flatMap((group) => group.items).slice(0, 3);
}

export type ChangelogMenuLink = {
  href: string;
  external: boolean;
};

// Same-app visits stay on /changelog. A configured public origin on another host opens that origin's page.
// Absolute changelog URL from the configured public origin, or the in-app path when that origin is absent.
export function changelogAnchorHref(configuredUrl: string | null | undefined) {
  const configured = configuredUrl?.trim();
  if (!configured) return changelogPath;
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return changelogPath;
    return new URL(changelogPath, `${parsed.origin}/`).href;
  } catch {
    return changelogPath;
  }
}

export function changelogMenuLink(configuredUrl: string | null | undefined, currentOrigin?: string | null): ChangelogMenuLink {
  const configured = configuredUrl?.trim();
  if (!configured) return { href: changelogPath, external: false };

  let origin: string;
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return { href: changelogPath, external: false };
    }
    origin = parsed.origin;
  } catch {
    return { href: changelogPath, external: false };
  }

  if (!currentOrigin || currentOrigin === origin) return { href: changelogPath, external: false };
  return { href: new URL(changelogPath, `${origin}/`).href, external: true };
}

// Small static format: title, intro lines, then ## entries with an optional date line and ### groups of "- " items.
export function parseChangelog(markdown: string): ChangelogDocument {
  const title = "Changelog";
  const intro: string[] = [];
  const entries: ChangelogEntry[] = [];
  let documentTitle = title;
  let entry: ChangelogEntry | null = null;
  let group: ChangelogGroup | null = null;
  let inIntro = true;

  for (const raw of markdown.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("<!--")) continue;

    if (line.startsWith("# ")) {
      documentTitle = line.slice(2).trim() || title;
      continue;
    }

    if (line.startsWith("## ")) {
      if (entry) entries.push(entry);
      entry = { version: line.slice(3).trim(), groups: [] };
      group = null;
      inIntro = false;
      continue;
    }

    if (line.startsWith("### ")) {
      if (!entry) continue;
      group = { heading: line.slice(4).trim(), items: [] };
      if (group.heading) entry.groups.push(group);
      inIntro = false;
      continue;
    }

    if (line.startsWith("- ")) {
      const item = line.slice(2).trim();
      if (entry && group && item) group.items.push(item);
      continue;
    }

    if (inIntro) {
      intro.push(line);
      continue;
    }

    if (entry && !entry.date && entry.groups.length === 0) entry.date = line;
  }

  if (entry) entries.push(entry);

  return {
    title: documentTitle,
    intro,
    entries: entries.map((item) => ({ ...item, groups: item.groups.filter((section) => section.items.length > 0) })),
  };
}
