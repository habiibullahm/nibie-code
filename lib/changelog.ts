export const changelogPath = "/changelog";

// Newest public notes, one line each. The first three items in CHANGELOG.md use this same wording.
export const changelogPreview = [
  "Rooms keep a brief, instructions, and their own threads",
  "Pins and selected files stay with the Room you are in",
  "Settings cover language, the model, and how Nibie replies",
] as const;

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
