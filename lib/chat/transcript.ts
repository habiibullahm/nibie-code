import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { markdownToClipboard } from "@/lib/markdown/clipboard";

/** Page size when reading one conversation's messages for a transcript. */
export const TRANSCRIPT_PAGE_SIZE = 200;
/** Hard cap: fail closed rather than silently truncating a long thread. */
export const TRANSCRIPT_MAX_MESSAGES = 5_000;
/** Approximate UTF-8 budget (~2 MiB) before the request is rejected. */
export const TRANSCRIPT_MAX_CHARS = 2_000_000;

export const TRANSCRIPT_OVERSIZE_ERROR = "This conversation is too large to export as a transcript.";
export const TRANSCRIPT_LOAD_ERROR = "This transcript couldn't be prepared. Please try again.";
export const TRANSCRIPT_NOT_FOUND_ERROR = "Conversation not found.";

export type TranscriptFormat = "plain" | "markdown";

export type TranscriptMessageInput = {
  id: string;
  role: string;
  content: string;
  status: string;
  position: number;
  created_at: string | Date;
};

export type TranscriptConversationInput = {
  id: string;
  title: string;
};

export type TranscriptTurn = {
  id: string;
  role: "user" | "assistant";
  /** Sanitized visible content (assistant reasoning stripped). */
  content: string;
  status: "complete" | "interrupted";
  position: number;
  createdAt: string;
};

const includedStatuses = new Set(["complete", "interrupted"]);
const includedRoles = new Set(["user", "assistant"]);

function toIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

/** Keep complete and interrupted user/assistant turns; drop streaming, error, and unknown roles. */
export function selectTranscriptTurns(messages: readonly TranscriptMessageInput[]): TranscriptTurn[] | null {
  const turns: TranscriptTurn[] = [];
  for (const message of messages) {
    if (!includedRoles.has(message.role) || !includedStatuses.has(message.status)) continue;
    if (!Number.isInteger(message.position)) return null;
    const content = message.role === "assistant"
      ? sanitizeModelOutput(message.content ?? "").text
      : String(message.content ?? "");
    turns.push({
      id: message.id,
      role: message.role as "user" | "assistant",
      content,
      status: message.status as "complete" | "interrupted",
      position: message.position,
      createdAt: toIso(message.created_at),
    });
  }
  turns.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  return turns;
}

function roleLabel(role: "user" | "assistant"): string {
  return role === "user" ? "User" : "Assistant";
}

function turnHeading(turn: TranscriptTurn, markdown: boolean): string {
  const label = roleLabel(turn.role);
  const stopped = turn.status === "interrupted" ? " · Stopped" : "";
  const stamp = turn.createdAt;
  if (markdown) return `## ${label}${stopped}\n\n_${stamp}_`;
  return `${label}${stopped} (${stamp})`;
}

function plainBody(turn: TranscriptTurn): string {
  if (turn.role === "assistant") return markdownToClipboard(turn.content).plain;
  return turn.content.replace(/\r\n/g, "\n").trimEnd();
}

function markdownBody(turn: TranscriptTurn): string {
  return turn.content.replace(/\r\n/g, "\n").trimEnd();
}

export function formatTranscriptPlain(title: string, turns: readonly TranscriptTurn[]): string {
  const header = (title.trim() || "Untitled conversation").trim();
  const parts = [`${header}`, ""];
  for (const turn of turns) {
    parts.push(turnHeading(turn, false));
    parts.push("");
    const body = plainBody(turn);
    if (body) parts.push(body);
    parts.push("");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function formatTranscriptMarkdown(title: string, turns: readonly TranscriptTurn[]): string {
  const header = (title.trim() || "Untitled conversation").trim();
  const parts = [`# ${header}`, ""];
  for (const turn of turns) {
    parts.push(turnHeading(turn, true));
    parts.push("");
    const body = markdownBody(turn);
    if (body) parts.push(body);
    parts.push("");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function buildTranscriptText(
  conversation: TranscriptConversationInput,
  messages: readonly TranscriptMessageInput[],
  format: TranscriptFormat,
): { text: string; turnCount: number } | { error: string; status: 413 | 503 } {
  if (messages.length > TRANSCRIPT_MAX_MESSAGES) {
    return { error: TRANSCRIPT_OVERSIZE_ERROR, status: 413 };
  }
  const turns = selectTranscriptTurns(messages);
  if (!turns) return { error: TRANSCRIPT_LOAD_ERROR, status: 503 };
  const text = format === "plain"
    ? formatTranscriptPlain(conversation.title, turns)
    : formatTranscriptMarkdown(conversation.title, turns);
  if (text.length > TRANSCRIPT_MAX_CHARS) {
    return { error: TRANSCRIPT_OVERSIZE_ERROR, status: 413 };
  }
  return { text, turnCount: turns.length };
}

/** Safe download basename from a conversation title (no path separators or control chars). */
export function transcriptFilename(title: string): string {
  const slug = title
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
  const base = slug || "conversation";
  return `${base}.md`;
}

export function contentDispositionAttachment(filename: string): string {
  // ASCII fallback plus RFC 5987 UTF-8 filename for non-Latin titles.
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
