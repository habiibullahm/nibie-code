import type { MemoryIntent } from "@/lib/recall/types";

const SAVE_PREFIXES = [
  /^remember\s+that\s+/i,
  /^remember\s+/i,
  /^save\s+this\s+for\s+later\s*:?\s*/i,
  /^keep\s+this\s+in\s+mind\s*:?\s*/i,
  /^ingat\s+bahwa\s+/i,
  /^ingat\s+untuk\s+percakapan\s+berikutnya\s*:?\s*/i,
  /^ingat\s+/i,
  /^simpan\s+ini\s*:?\s*/i,
];

const FORGET_PREFIXES = [
  /^forget\s+that\s+/i,
  /^forget\s+/i,
  /^stop\s+remembering\s+/i,
  /^don't\s+remember\s+/i,
  /^do\s+not\s+remember\s+/i,
  /^jangan\s+ingat\s+lagi\s+/i,
  /^jangan\s+ingat\s+/i,
  /^lupakan\s+/i,
];

// Transient / one-shot tasks that must never become durable memory, even with a soft "remember".
const TRANSIENT = [
  /^(what'?s|what\s+is|how\s+(?:do|to|can)|why\s+|when\s+|where\s+)/i,
  /^(fix|explain|generate|summarize|summarise|translate|rewrite|debug|implement|write|create|make|list|show|find)\b/i,
  /^(perbaiki|jelaskan|buatkan|ringkas|terjemahkan|generate)\b/i,
  /\b(ihsg|rest\s+api|sql\s+query|typo)\b/i,
];

function stripPrefix(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    if (pattern.test(text)) return text.replace(pattern, "").trim();
  }
  return null;
}

function isTransient(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return true;
  if (trimmed.endsWith("?") && trimmed.length < 80) return true;
  return TRANSIENT.some((pattern) => pattern.test(trimmed));
}

/** Deterministic EN+ID save/forget detection. Explicit-memory-first; never auto-extract. */
export function detectMemoryIntent(message: string): MemoryIntent {
  const raw = message.trim().replace(/\s+/g, " ");
  if (!raw) return { kind: "none" };

  const forgetBody = stripPrefix(raw, FORGET_PREFIXES);
  if (forgetBody !== null) {
    if (!forgetBody || isTransient(forgetBody)) return { kind: "none" };
    return { kind: "forget", raw: forgetBody };
  }

  const saveBody = stripPrefix(raw, SAVE_PREFIXES);
  if (saveBody !== null) {
    if (!saveBody || isTransient(saveBody)) return { kind: "none" };
    return { kind: "save", raw: saveBody };
  }

  return { kind: "none" };
}
