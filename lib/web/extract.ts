/**
 * HTML → readable plain text without a headless browser.
 * Scripts, styles, and common chrome are discarded; output is size-capped.
 */

export const MAX_WEB_EXTRACT_CHARS = 20_000;

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => ENTITY_MAP[name.toLowerCase()] ?? match);
}

function stripNoise(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|header|aside|form|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function tagsToSpace(html: string): string {
  return html
    .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

/**
 * Extract readable text from HTML or plain text. Caps at `maxChars` (default 20k).
 * Prompt-injection strings in the page remain ordinary page content — callers must
 * treat the result as untrusted data, never as product policy.
 */
export function extractReadableText(input: string, maxChars = MAX_WEB_EXTRACT_CHARS): string {
  if (!input) return "";
  const stripped = stripNoise(input);
  const withBreaks = tagsToSpace(stripped);
  const decoded = decodeEntities(withBreaks);
  const collapsed = decoded
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (collapsed.length <= maxChars) return collapsed;

  // Prefer a clean cut at a word boundary when cheap.
  const slice = collapsed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.8) return slice.slice(0, lastSpace).trimEnd();
  return slice.trimEnd();
}
