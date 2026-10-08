import { describe, expect, it, vi } from "vitest";
import {
  markdownToClipboard,
  safeClipboardHref,
  writeFormattedClipboard,
} from "../../lib/markdown/clipboard";

const sample = [
  "## Kesimpulan",
  "",
  "**0,39%** naik hari ini. Lihat [MDN](https://developer.mozilla.org/docs) dan sumber [1], bukan [9].",
  "",
  "1. Pertama",
  "2. Kedua",
  "",
  "- bullet",
  "",
  "| A | B |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "> quoted",
].join("\n");

describe("safeClipboardHref", () => {
  it("allows http(s) and mailto without credentials", () => {
    expect(safeClipboardHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeClipboardHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
  });

  it("rejects unsafe schemes and credentialed URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "vbscript:x",
      "https://user:pass@evil.test/",
      "/relative",
      "",
    ]) {
      expect(safeClipboardHref(bad)).toBeNull();
    }
  });
});

describe("markdownToClipboard", () => {
  it("produces Word-safe HTML without Markdown markers or dark theme styles", () => {
    const { html, plain } = markdownToClipboard(sample, [
      { ordinal: 1, url: "https://nodejs.org/en" },
    ]);

    expect(html).toContain("<h2");
    expect(html).toContain("<strong>0,39%</strong>");
    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html).toContain("<table");
    expect(html).toContain("<pre");
    expect(html).toContain("const x = 1;");
    expect(html).toContain('href="https://developer.mozilla.org/docs"');
    expect(html).toContain('href="https://nodejs.org/en"');
    expect(html).toContain("[1]");
    expect(html).toContain("[9]");
    expect(html).not.toContain("**");
    expect(html).not.toContain("## ");
    expect(html).not.toContain("```");
    expect(html).not.toMatch(/background:\s*#000|background:\s*black|color:\s*#fff|color:\s*white/i);
    expect(html).toMatch(/color:#111111/);
    expect(html).toMatch(/background:transparent/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=");
    expect(html).not.toContain("onclick=");

    expect(plain).toContain("Kesimpulan");
    expect(plain).toContain("0,39%");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("##");
    expect(plain).not.toContain("```");
    expect(plain).toContain("1. Pertama");
    expect(plain).toContain("- bullet");
    expect(plain).toContain("A\tB");
    expect(plain).toContain("1\t2");
    expect(plain).toContain("const x = 1;");
    expect(plain).toContain("[1]");
    expect(plain).toContain("[9]");
    expect(plain).toMatch(/MDN \(https:\/\/developer\.mozilla\.org\/docs\)/);
  });

  it("strips model HTML and unsafe link targets while keeping visible text", () => {
    const { html, plain } = markdownToClipboard(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[click](javascript:alert(1))\n\n[ok](https://safe.example/)',
    );
    expect(html).not.toMatch(/<script|<img|onerror|javascript:/i);
    expect(html).toContain("click");
    expect(html).toContain('href="https://safe.example/"');
    expect(plain).toContain("click");
    expect(plain).toContain("ok");
    expect(plain).not.toContain("javascript:");
  });

  it("does not invent citation URLs for unknown ordinals", () => {
    const { html } = markdownToClipboard("Fact [2] and [1].", [
      { ordinal: 1, url: "https://example.com/one" },
      { ordinal: 2, url: "javascript:alert(1)" },
    ]);
    expect(html).toContain('href="https://example.com/one"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("[2]");
    // Unsafe citation URL must not become an href.
    expect(html).not.toMatch(/href="[^"]*"[^>]*>\[2\]/);
  });

  it("keeps Indonesian text and punctuation intact in plain output", () => {
    const { plain } = markdownToClipboard("**Kesimpulan:** pertumbuhan **0,39%** — “baik”.");
    expect(plain).toBe("Kesimpulan: pertumbuhan 0,39% — “baik”.");
  });

  it("is theme-independent (same payload regardless of caller theme)", () => {
    const a = markdownToClipboard("**Hi**");
    const b = markdownToClipboard("**Hi**");
    expect(a).toEqual(b);
    expect(a.html).toContain("background:transparent");
  });
});

describe("writeFormattedClipboard fallback", () => {
  it("falls back to plain text when ClipboardItem write fails", async () => {
    const writeText = vi.fn(async () => undefined);
    const write = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("ClipboardItem", class {
      constructor(public items: Record<string, Blob>) {}
    });
    vi.stubGlobal("navigator", {
      clipboard: { write, writeText },
    });

    await writeFormattedClipboard("<p>Hi</p>", "Hi plain");
    expect(write).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("Hi plain");
    vi.unstubAllGlobals();
  });

  it("uses writeText when ClipboardItem is unavailable", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    await writeFormattedClipboard("<p>Hi</p>", "plain only");
    expect(writeText).toHaveBeenCalledWith("plain only");
    vi.unstubAllGlobals();
  });
});
