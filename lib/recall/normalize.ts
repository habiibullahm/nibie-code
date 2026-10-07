import { createHash } from "node:crypto";
import { memoryContentLimit, memoryKeyLimit, memoryTypes, type MemoryDraft, type MemoryType } from "@/lib/recall/types";

const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const INSTRUCTION_CUES = /\b(always|never|prefer|please|gunakan|selalu|jangan|harus|should|must)\b/i;
const PREFERENCE_CUES = /\b(i\s+prefer|i\s+like|i\s+use|my\s+preferred|lebih\s+suka|saya\s+lebih)\b/i;
const PROJECT_CUES = /\b(project|repo|codebase|stack|deploy|production|staging|nibie|proyek)\b/i;

/** Strip save/forget wrappers that may remain and collapse whitespace. */
export function extractDurableStatement(raw: string) {
  return raw
    .replace(CONTROLS, "")
    .replace(/^(that\s+|this\s+|untuk\s+)/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeMemoryContent(raw: string) {
  const content = extractDurableStatement(raw);
  if (!content || content.length > memoryContentLimit) return null;
  return content;
}

/** Deterministic dedupe key from normalized content. */
export function buildNormalizedKey(content: string) {
  const collapsed = content.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= memoryKeyLimit) return collapsed;
  const hash = createHash("sha256").update(collapsed).digest("hex").slice(0, 16);
  return `${collapsed.slice(0, memoryKeyLimit - 17)}:${hash}`;
}

export function classifyMemoryType(content: string): MemoryType {
  if (PREFERENCE_CUES.test(content)) return "preference";
  if (INSTRUCTION_CUES.test(content)) return "instruction";
  if (PROJECT_CUES.test(content)) return "project";
  return "fact";
}

export function parseMemoryDraft(input: unknown): { data: MemoryDraft } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Choose a valid memory." };
  const row = input as Record<string, unknown>;
  const type = typeof row.type === "string" && (memoryTypes as readonly string[]).includes(row.type) ? (row.type as MemoryType) : null;
  const content = typeof row.content === "string" ? normalizeMemoryContent(row.content) : null;
  if (!type || !content) return { error: "Memory must be 1–1,000 characters with a valid type." };
  const normalizedKey = buildNormalizedKey(content);
  if (!normalizedKey) return { error: "Memory must be 1–1,000 characters with a valid type." };
  return {
    data: {
      type,
      content,
      normalizedKey,
      sourceConversationId: typeof row.sourceConversationId === "string" ? row.sourceConversationId : null,
      sourceMessageId: typeof row.sourceMessageId === "string" ? row.sourceMessageId : null,
    },
  };
}

export function draftFromSaveBody(raw: string, source?: { conversationId?: string | null; messageId?: string | null }): MemoryDraft | null {
  const content = normalizeMemoryContent(raw);
  if (!content) return null;
  const normalizedKey = buildNormalizedKey(content);
  if (!normalizedKey) return null;
  return {
    type: classifyMemoryType(content),
    content,
    normalizedKey,
    sourceConversationId: source?.conversationId ?? null,
    sourceMessageId: source?.messageId ?? null,
  };
}
