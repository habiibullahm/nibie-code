import type {
  BlockContent,
  Content,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** Citation metadata used only when a verified http(s) URL is available. */
export type ClipboardCitationSource = {
  ordinal: number;
  url: string | null;
};

export type ClipboardPayload = {
  /** Neutral Word/Docs-friendly HTML (no app theme, no scripts). */
  html: string;
  /** Readable plain text without Markdown markers. */
  plain: string;
};

const SAFE_HREF = /^(https?:|mailto:)/i;
const MAX_URL_LENGTH = 2048;

/** Allow only http(s)/mailto links; reject javascript:, data:, credentials, etc. */
export function safeClipboardHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH || !SAFE_HREF.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "mailto:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

type Ctx = {
  citations: Map<number, string>;
};

function citationUrl(ctx: Ctx, ordinal: number): string | null {
  return ctx.citations.get(ordinal) ?? null;
}

/** Split phrasing so known `[n]` markers become links (or plain spans) at normal size. */
function expandCitations(text: string, ctx: Ctx, asHtml: boolean): string {
  return text.replace(/\[(\d+)\]/g, (match, digits: string) => {
    const ordinal = Number(digits);
    const href = citationUrl(ctx, ordinal);
    if (!asHtml) return match;
    if (href) {
      return `<a href="${escapeAttr(href)}" style="color:#0563c1;text-decoration:underline;font-size:1em;">${escapeHtml(match)}</a>`;
    }
    return `<span style="font-size:1em;">${escapeHtml(match)}</span>`;
  });
}

function phrasingHtml(nodes: readonly PhrasingContent[] | undefined, ctx: Ctx): string {
  if (!nodes?.length) return "";
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += expandCitations(node.value, ctx, true);
        break;
      case "strong":
        out += `<strong>${phrasingHtml(node.children, ctx)}</strong>`;
        break;
      case "emphasis":
        out += `<em>${phrasingHtml(node.children, ctx)}</em>`;
        break;
      case "delete":
        out += `<s>${phrasingHtml(node.children, ctx)}</s>`;
        break;
      case "inlineCode":
        out += `<code style="font-family:Consolas,'Courier New',monospace;font-size:0.95em;background:#f3f3f3;color:#111111;padding:0 2px;">${escapeHtml(node.value)}</code>`;
        break;
      case "break":
        out += "<br />";
        break;
      case "link": {
        const href = safeClipboardHref(node.url);
        const label = phrasingHtml(node.children, ctx) || escapeHtml(node.url ?? "");
        out += href
          ? `<a href="${escapeAttr(href)}" style="color:#0563c1;text-decoration:underline;">${label}</a>`
          : label;
        break;
      }
      case "image":
        out += node.alt ? escapeHtml(node.alt) : "";
        break;
      case "html":
        // Model-supplied HTML is untrusted — never emit it.
        break;
      default:
        if ("children" in node && Array.isArray(node.children)) {
          out += phrasingHtml(node.children as PhrasingContent[], ctx);
        }
        break;
    }
  }
  return out;
}

function phrasingPlain(nodes: readonly PhrasingContent[] | undefined, ctx: Ctx): string {
  if (!nodes?.length) return "";
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += expandCitations(node.value, ctx, false);
        break;
      case "strong":
      case "emphasis":
      case "delete":
        out += phrasingPlain(node.children, ctx);
        break;
      case "inlineCode":
        out += node.value;
        break;
      case "break":
        out += "\n";
        break;
      case "link": {
        const label = phrasingPlain(node.children, ctx) || node.url || "";
        const href = safeClipboardHref(node.url);
        out += href && label !== href ? `${label} (${href})` : label;
        break;
      }
      case "image":
        out += node.alt ?? "";
        break;
      case "html":
        break;
      default:
        if ("children" in node && Array.isArray(node.children)) {
          out += phrasingPlain(node.children as PhrasingContent[], ctx);
        }
        break;
    }
  }
  return out;
}

const PRE_STYLE =
  "font-family:Consolas,'Courier New',monospace;font-size:11pt;line-height:1.4;background:#f5f5f5;color:#111111;border:1px solid #dddddd;padding:8pt;white-space:pre-wrap;";
const TABLE_STYLE = "border-collapse:collapse;border:1px solid #cccccc;font-size:11pt;color:#111111;";
const CELL_STYLE = "border:1px solid #cccccc;padding:4pt 6pt;vertical-align:top;color:#111111;background:transparent;";
const BLOCKQUOTE_STYLE = "margin:8pt 0;padding-left:10pt;border-left:3pt solid #cccccc;color:#222222;";

function listHtml(node: List, ctx: Ctx): string {
  const tag = node.ordered ? "ol" : "ul";
  const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
  const items = node.children.map((item) => listItemHtml(item, ctx)).join("");
  return `<${tag}${start} style="margin:8pt 0;padding-left:22pt;color:#111111;">${items}</${tag}>`;
}

function listItemHtml(item: ListItem, ctx: Ctx): string {
  const body = item.children.map((child) => {
    if (child.type === "paragraph") return phrasingHtml(child.children, ctx);
    if (child.type === "list") return listHtml(child, ctx);
    return blockHtml(child as BlockContent, ctx);
  }).join("");
  return `<li style="margin:2pt 0;color:#111111;font-size:11pt;">${body}</li>`;
}

function tableHtml(node: Table, ctx: Ctx): string {
  const rows = node.children.map((row, index) => tableRowHtml(row, index === 0, ctx)).join("");
  return `<table style="${TABLE_STYLE}">${rows}</table>`;
}

function tableRowHtml(row: TableRow, header: boolean, ctx: Ctx): string {
  const tag = header ? "th" : "td";
  const cells = row.children.map((cell) => tableCellHtml(cell, tag, ctx)).join("");
  return `<tr>${cells}</tr>`;
}

function tableCellHtml(cell: TableCell, tag: "th" | "td", ctx: Ctx): string {
  const weight = tag === "th" ? "font-weight:600;" : "";
  return `<${tag} style="${CELL_STYLE}${weight}">${phrasingHtml(cell.children, ctx)}</${tag}>`;
}

function blockHtml(node: Content | RootContent, ctx: Ctx): string {
  switch (node.type) {
    case "paragraph":
      return `<p style="margin:0 0 8pt;color:#111111;font-size:11pt;line-height:1.45;">${phrasingHtml(node.children, ctx)}</p>`;
    case "heading": {
      const level = Math.min(Math.max(node.depth, 1), 6);
      const sizes = ["16pt", "14pt", "12pt", "11pt", "11pt", "11pt"];
      return `<h${level} style="margin:12pt 0 6pt;color:#111111;font-size:${sizes[level - 1]};font-weight:600;line-height:1.3;">${phrasingHtml(node.children, ctx)}</h${level}>`;
    }
    case "list":
      return listHtml(node, ctx);
    case "table":
      return tableHtml(node, ctx);
    case "blockquote": {
      const inner = node.children.map((child) => blockHtml(child, ctx)).join("");
      return `<blockquote style="${BLOCKQUOTE_STYLE}">${inner}</blockquote>`;
    }
    case "code":
      return `<pre style="${PRE_STYLE}"><code style="font-family:inherit;color:inherit;background:transparent;">${escapeHtml(node.value.replace(/\n$/, ""))}</code></pre>`;
    case "thematicBreak":
      return `<hr style="border:0;border-top:1px solid #cccccc;margin:12pt 0;" />`;
    case "html":
    case "definition":
    case "yaml":
      return "";
    default:
      if ("children" in node && Array.isArray((node as { children?: unknown }).children)) {
        return ((node as { children: Content[] }).children).map((child) => blockHtml(child, ctx)).join("");
      }
      return "";
  }
}

function listPlain(node: List, ctx: Ctx, indent = ""): string {
  return node.children.map((item, index) => {
    const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : "- ";
    const lines: string[] = [];
    for (const child of item.children) {
      if (child.type === "paragraph") lines.push(`${indent}${marker}${phrasingPlain(child.children, ctx)}`);
      else if (child.type === "list") lines.push(listPlain(child, ctx, `${indent}  `));
      else lines.push(`${indent}${marker}${blockPlain(child as BlockContent, ctx).trim()}`);
    }
    return lines.join("\n");
  }).join("\n");
}

function tablePlain(node: Table, ctx: Ctx): string {
  return node.children.map((row) => row.children.map((cell) => phrasingPlain(cell.children, ctx)).join("\t")).join("\n");
}

function blockPlain(node: Content | RootContent, ctx: Ctx): string {
  switch (node.type) {
    case "paragraph":
      return phrasingPlain(node.children, ctx);
    case "heading":
      return phrasingPlain(node.children, ctx);
    case "list":
      return listPlain(node, ctx);
    case "table":
      return tablePlain(node, ctx);
    case "blockquote":
      return node.children.map((child) => blockPlain(child, ctx)).join("\n").split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
    case "code":
      return node.value.replace(/\n$/, "");
    case "thematicBreak":
      return "---";
    case "html":
    case "definition":
    case "yaml":
      return "";
    default:
      if ("children" in node && Array.isArray((node as { children?: unknown }).children)) {
        return ((node as { children: Content[] }).children).map((child) => blockPlain(child, ctx)).join("\n\n");
      }
      return "";
  }
}

function buildCitationMap(sources: readonly ClipboardCitationSource[] | undefined): Map<number, string> {
  const map = new Map<number, string>();
  if (!sources?.length) return map;
  for (const source of sources) {
    const href = safeClipboardHref(source.url);
    if (href) map.set(source.ordinal, href);
  }
  return map;
}

function parseMarkdown(markdown: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
}

/**
 * Convert assistant Markdown source into Word-safe HTML and clean plain text.
 * Does not copy rendered DOM, theme CSS, or model-supplied HTML.
 */
export function markdownToClipboard(
  markdown: string,
  sources?: readonly ClipboardCitationSource[],
): ClipboardPayload {
  const ctx: Ctx = { citations: buildCitationMap(sources) };
  const tree = parseMarkdown(markdown ?? "");
  const body = tree.children.map((child) => blockHtml(child, ctx)).join("");
  const plain = tree.children
    .map((child) => blockPlain(child, ctx))
    .filter((part) => part.length > 0)
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Neutral document shell — black text, transparent background, no app chrome.
  const html = `<!DOCTYPE html><html><body style="margin:0;background:transparent;color:#111111;font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;">${body}</body></html>`;
  return { html, plain };
}

/** Plain-text clipboard write with textarea fallback when the Async Clipboard API is missing. */
export async function writePlainClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") throw new Error("Copy failed.");
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy failed.");
}

/** Prefer ClipboardItem with html+plain; fall back to clean plain text when rich clipboard is unavailable. */
export async function writeFormattedClipboard(html: string, plain: string) {
  if (typeof ClipboardItem !== "undefined" && typeof navigator !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain-text write (unsupported type, permission, or secure-context issues).
    }
  }
  await writePlainClipboard(plain);
}
