import { validateConversationId } from "@/lib/chat/validation";

// Stop is server-authoritative: the reply row itself records it, so it reaches the generation on whichever instance runs it.
// The generation checks its row on this interval and aborts the provider once the row is no longer streaming.
export const stopPollMs = 1000;
export const claimPlaceholder = "…";
export const stoppedPlaceholder = "Response stopped.";
export const unavailablePlaceholder = "Response unavailable.";
// Longer than any single reply; also keeps one Stop well inside request body limits.
export const maxStoppedContentChars = 100_000;

export type StopRequest = { userMessageId: string; assistantId: string | null; content: string | null };
type ReplyState = { status: string; content: string };

// What the user saw when they pressed Stop is what the reply keeps. Nothing visible yet keeps a readable notice, never the claim placeholder.
export function stoppedContent(partial: string) {
  return partial.trim() && partial !== claimPlaceholder ? partial : stoppedPlaceholder;
}

// Decides whether a Stop may (re)write a reply. `content` is the exact text the client showed, or null for a status-only Stop.
// A reply that finished, failed or was saved by the stream before the Stop landed is cut back to what the user saw, but only
// when that text is a prefix of what was saved, so a Stop can never put different words in a reply. Repeating it changes nothing.
export function stopDecision(reply: ReplyState, content: string | null): "write" | "done" | "skip" {
  if (reply.status === "streaming") return "write";
  if (content === null) return reply.status === "interrupted" ? "done" : "skip";
  const target = stoppedContent(content);
  if (reply.status === "interrupted" && reply.content === target) return "done";
  if (reply.content === claimPlaceholder || reply.content === stoppedPlaceholder || reply.content === unavailablePlaceholder) return "write";
  return reply.content.startsWith(content) ? "write" : "skip";
}

function parseContent(value: unknown): { ok: true; content: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, content: null };
  if (typeof value !== "string" || value.length > maxStoppedContentChars) return { ok: false };
  return { ok: true, content: value };
}

function parseOptionalId(value: unknown): { ok: true; id: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, id: null };
  const parsed = validateConversationId(value);
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false };
}

// One Stop: the stopped user message, and when known, the reply it started and the text the user saw.
export function parseStopRequest(userMessageId: unknown, assistantId?: unknown, content?: unknown): StopRequest | null {
  const message = validateConversationId(userMessageId);
  const assistant = parseOptionalId(assistantId);
  const text = parseContent(content);
  if (!message.success || !assistant.ok || !text.ok) return null;
  return { userMessageId: message.data, assistantId: assistant.id, content: text.content };
}

// Stops carried by the next message: bare user message ids (older clients) or full Stop records.
export function parseStopRequests(value: unknown): StopRequest[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const stops = new Map<string, StopRequest>();
  for (const item of value) {
    const stop = typeof item === "string" ? parseStopRequest(item)
      : item && typeof item === "object" ? parseStopRequest((item as Record<string, unknown>).userMessageId, (item as Record<string, unknown>).assistantId, (item as Record<string, unknown>).content)
        : null;
    if (!stop) return null;
    stops.set(stop.userMessageId, stop);
  }
  return [...stops.values()];
}
