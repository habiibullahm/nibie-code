import "server-only";

import { assertSafeFetchUrl, SsrfError, type DnsLookup } from "@/lib/web/ssrf";

export const WEB_FETCH_TIMEOUT_MS = 8_000;
export const WEB_FETCH_MAX_BYTES = 512 * 1024;
export const WEB_FETCH_MAX_REDIRECTS = 3;
export const WEB_FETCH_USER_AGENT = "NibieBot/1.0 (+https://nibie.app; web-search)";

const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"] as const;

export type FetchFailureCategory =
  | "timeout"
  | "http_status"
  | "ssrf_blocked"
  | "content_type"
  | "size_limit"
  | "parse_error";

export class WebFetchError extends Error {
  readonly category: FetchFailureCategory;

  constructor(category: FetchFailureCategory, message: string) {
    super(message);
    this.name = "WebFetchError";
    this.category = category;
  }
}

export type FetchedPage = {
  url: string;
  finalUrl: string;
  contentType: string;
  body: string;
};

export type FetchWebPageOptions = {
  signal: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  lookup?: DnsLookup;
  fetchImpl?: typeof fetch;
};

function contentTypeAllowed(header: string | null): string | null {
  if (!header) return null;
  const media = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if ((ALLOWED_CONTENT_TYPES as readonly string[]).includes(media)) return media;
  return null;
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new WebFetchError("size_limit", "response_too_large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WebFetchError("size_limit", "response_too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function mergeSignals(user: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === "function") return AbortSignal.any([user, timeout]);
  return timeout;
}

/**
 * Bounded HTTP(S) GET with SSRF checks on the initial URL and every redirect target.
 * Does not follow redirects automatically — each hop is re-validated.
 */
export async function fetchWebPage(url: string, opts: FetchWebPageOptions): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? WEB_FETCH_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? WEB_FETCH_MAX_REDIRECTS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup;

  let current = url;
  let redirects = 0;

  try {
    while (true) {
      const safeUrl = await assertSafeFetchUrl(current, lookup);
      const signal = mergeSignals(opts.signal, timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(safeUrl.toString(), {
          method: "GET",
          redirect: "manual",
          signal,
          headers: {
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            "User-Agent": WEB_FETCH_USER_AGENT,
          },
        });
      } catch (error) {
        if (error instanceof SsrfError) throw error;
        if (opts.signal.aborted || (error instanceof Error && error.name === "AbortError") || signal.aborted) {
          throw new WebFetchError("timeout", "fetch_aborted_or_timed_out");
        }
        throw new WebFetchError("parse_error", "network_error");
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new WebFetchError("http_status", `redirect_without_location_${response.status}`);
        if (redirects >= maxRedirects) throw new WebFetchError("http_status", "too_many_redirects");
        redirects += 1;
        current = new URL(location, safeUrl).toString();
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new WebFetchError("http_status", `status_${response.status}`);
      }

      const contentType = contentTypeAllowed(response.headers.get("content-type"));
      if (!contentType) throw new WebFetchError("content_type", "disallowed_content_type");

      const body = await readBodyLimited(response, maxBytes);
      return {
        url,
        finalUrl: safeUrl.toString(),
        contentType,
        body,
      };
    }
  } catch (error) {
    if (error instanceof SsrfError) {
      throw new WebFetchError("ssrf_blocked", error.message);
    }
    throw error;
  }
}
