import { markdownToClipboard } from "@/lib/markdown/clipboard";
import { untitledWorkbenchTitle } from "@/lib/workbench/types";

export type WorkbenchExportFormat = "md" | "txt";

/** Filesystem-safe Unicode download basename from a document title (no path separators or control chars). */
export function workbenchExportBasename(title: string): string {
  const trimmed = title.trim() || untitledWorkbenchTitle;
  const cleaned = Array.from(trimmed
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim())
    // Keep complete Unicode characters so UTF-8 Content-Disposition encoding cannot split an emoji.
    .slice(0, 80)
    .join("");
  const dashed = (cleaned || untitledWorkbenchTitle)
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return dashed || "document";
}

export function workbenchExportFilename(title: string, format: WorkbenchExportFormat): string {
  return `${workbenchExportBasename(title)}.${format}`;
}

/** Content-Disposition for UTF-8 filenames with an ASCII fallback. */
export function workbenchExportContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "document.txt";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** Plain-text export body: document content only (title is the download name). */
export function workbenchPlainExportBody(content: string): string {
  return markdownToClipboard(content.replace(/\r\n/g, "\n")).plain;
}

/** Markdown export: optional H1 title when content does not already start with a heading. */
export function workbenchMarkdownExportBody(title: string, content: string): string {
  const body = content.replace(/\r\n/g, "\n");
  const trimmed = body.trimStart();
  if (!trimmed) return `# ${title.trim() || untitledWorkbenchTitle}\n`;
  if (/^#{1,6}\s/.test(trimmed)) return body.endsWith("\n") ? body : `${body}\n`;
  return `# ${title.trim() || untitledWorkbenchTitle}\n\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export function parseWorkbenchExportFormat(value: string | null): WorkbenchExportFormat | null {
  if (value === "md" || value === "txt") return value;
  return null;
}
