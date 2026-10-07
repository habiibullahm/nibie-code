import type { MemoryType } from "@/lib/recall/types";

/**
 * Lightweight topic identity for V1 replacement. Conservative: return null when ambiguous
 * so we keep both memories rather than deleting the wrong one.
 */
export function memoryTopicKey(type: MemoryType, content: string): string | null {
  const lower = content.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower) return null;

  if (type === "preference" || type === "instruction") {
    if (
      /\b(prefer|like|use|suka)\b/.test(lower)
      && (
        /\b(example|examples|snippet|code\s+example)/.test(lower)
        || /\b(typescript|javascript|python|golang?|rust|java)\b/.test(lower)
      )
    ) {
      return "preference:code_examples";
    }
    if (/\b(concise|brief|short|detailed|verbose|panjang|singkat)\b/.test(lower) && /\b(answer|response|reply|jawaban|respon)\b/.test(lower)) {
      return "preference:answer_length";
    }
    return null;
  }

  const entity = extractProjectEntity(lower);
  if (!entity) return null;

  if (/\b(mysql|postgres(?:ql)?|neon|mongodb|mongo|redis|sqlite|database|\bdb\b)\b/.test(lower)) {
    return `project:${entity}:database`;
  }
  if (/\b(deploy|deployment|hosting|vercel|seoul|region)\b/.test(lower)) {
    return `project:${entity}:deploy`;
  }
  if (/\b(stack|framework|runtime|backend|frontend)\b/.test(lower)) {
    return `project:${entity}:stack`;
  }
  return null;
}

function extractProjectEntity(lower: string): string | null {
  const projectNamed = lower.match(/\bproject\s+([a-z0-9][\w.-]{0,40})\b/);
  if (projectNamed?.[1]) return projectNamed[1].replace(/[^a-z0-9._-]/g, "");

  // "Cedar uses PostgreSQL" / "Cedar's database"
  const leading = lower.match(/\b([a-z][a-z0-9._-]{1,40})\s+(?:now\s+)?(?:uses|use|runs|deploys|is|menggunakan)\b/);
  if (leading?.[1] && !STOP_ENTITIES.has(leading[1])) return leading[1];

  const possessive = lower.match(/\b([a-z][a-z0-9._-]{1,40})(?:'s|\s+database|\s+db)\b/);
  if (possessive?.[1] && !STOP_ENTITIES.has(possessive[1])) return possessive[1];

  return null;
}

const STOP_ENTITIES = new Set([
  "i", "we", "it", "this", "that", "the", "a", "an", "my", "our", "your",
  "production", "staging", "backend", "frontend", "database", "project",
  "saya", "kami", "itu", "ini", "yang",
]);
