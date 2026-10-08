/**
 * Redact GitHub tokens and credential-shaped strings from text that may be
 * logged, summarized, or returned in Action error messages.
 * Never use for authorization — only for output sanitization.
 */
const GITHUB_TOKEN_VALUE =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|ghu_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]{8,}|sk-[a-zA-Z0-9]{10,})\b/g;

export function redactSecrets(text: string): string {
  return text.replace(GITHUB_TOKEN_VALUE, "[redacted]");
}

export function redactUnknown(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactSecrets(value).slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(redactUnknown);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|authorization|password|credential|cookie|api[_-]?key/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactUnknown(child);
      }
    }
    return out;
  }
  return String(value).slice(0, 80);
}
