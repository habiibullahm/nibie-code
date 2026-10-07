const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TAG_LIKE = /<\/?[a-zA-Z][^>]*>/g;
const ANGLE_BRACKETS = /[<>]/g;

export const MAX_CITATION_TITLE_LENGTH = 200;
export const MAX_CITATION_EXCERPT_LENGTH = 480;
export const MAX_CITATION_DOMAIN_LENGTH = 253;
export const MAX_CITATION_URL_LENGTH = 2048;

/** Strip markup and control characters from titles shown in the UI or stored as citation metadata. */
export function sanitizeCitationTitle(raw: string, fallback = "Source"): string {
  const cleaned = raw
    .replace(CONTROL_CHARS, "")
    .replace(TAG_LIKE, " ")
    .replace(ANGLE_BRACKETS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > MAX_CITATION_TITLE_LENGTH
    ? `${cleaned.slice(0, MAX_CITATION_TITLE_LENGTH - 1).trimEnd()}…`
    : cleaned;
}

export function sanitizeCitationExcerpt(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw
    .replace(CONTROL_CHARS, "")
    .replace(TAG_LIKE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_CITATION_EXCERPT_LENGTH
    ? `${cleaned.slice(0, MAX_CITATION_EXCERPT_LENGTH - 1).trimEnd()}…`
    : cleaned;
}

/** Allow only http(s) URLs for citation metadata. Reject credentials and unsafe schemes. */
export function sanitizeCitationUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CITATION_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

export function sanitizeCitationDomain(raw: string | null | undefined, url: string | null): string | null {
  const fromRaw = raw?.replace(CONTROL_CHARS, "").trim().toLowerCase() ?? "";
  if (fromRaw && fromRaw.length <= MAX_CITATION_DOMAIN_LENGTH && !/[<>\s]/.test(fromRaw)) {
    return fromRaw;
  }
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
