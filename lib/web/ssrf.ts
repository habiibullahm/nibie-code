import "server-only";

import dns from "node:dns/promises";
import net from "node:net";

/** Injectable DNS lookup for tests. Returns IPv4/IPv6 address strings. */
export type DnsLookup = (hostname: string) => Promise<string[]>;

export type SsrfFailureCategory = "ssrf_blocked";

export class SsrfError extends Error {
  readonly category: SsrfFailureCategory = "ssrf_blocked";

  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".corp",
  ".home",
  ".lan",
  ".private",
];

const defaultLookup: DnsLookup = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((row) => row.address);
};

function parseIpv4Octets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

/** Expand compressed IPv6 into eight zero-padded hextets, or null. */
function expandIpv6(ip: string): string[] | null {
  const stripped = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (stripped.includes(".")) return null;
  const sides = stripped.split("::");
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(":") : [];
  if (sides.length === 1) {
    if (left.length !== 8) return null;
    return left.map((h) => h.padStart(4, "0"));
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((h) => h.padStart(4, "0"));
}

/** Coerce integer / short dotted forms that some stacks treat as IPv4. */
export function coerceIpv4Literal(hostname: string): string | null {
  if (net.isIPv4(hostname)) return hostname;
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  // Incomplete dotted forms (e.g. 127.1 → 127.0.0.1) — fail closed by treating as blocked after expansion attempt
  const parts = hostname.split(".");
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^\d+$/.test(p))) {
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)) return null;
    if (parts.length === 4) {
      const octets = parseIpv4Octets(hostname);
      return octets ? hostname : null;
    }
    if (parts.length === 2) {
      const a = nums[0]!;
      const b = nums[1]!;
      if (a > 255 || b > 0xffffff) return null;
      return [a, (b >>> 16) & 255, (b >>> 8) & 255, b & 255].join(".");
    }
    if (parts.length === 3) {
      const [a, b, c] = nums as [number, number, number];
      if (a > 255 || b > 255 || c > 0xffff) return null;
      return [a, b, (c >>> 8) & 255, c & 255].join(".");
    }
  }
  return null;
}

export function isBlockedIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized.startsWith("::ffff:")) {
    return isBlockedIp(normalized.slice("::ffff:".length));
  }

  const asV4 = coerceIpv4Literal(normalized) ?? (net.isIPv4(normalized) ? normalized : null);
  if (asV4) {
    const octets = parseIpv4Octets(asV4);
    if (!octets) return true;
    const [a, b] = octets;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / carrier-grade
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  if (net.isIPv6(normalized)) {
    const hextets = expandIpv6(normalized);
    if (!hextets) return true;
    const first = Number.parseInt(hextets[0]!, 16);
    // fe80::/10 link-local
    if (first >= 0xfe80 && first <= 0xfebf) return true;
    // fc00::/7 unique local
    if ((first & 0xfe00) === 0xfc00) return true;
    // ff00::/8 multicast
    if ((first & 0xff00) === 0xff00) return true;
    return false;
  }

  return true; // unknown address shape — fail closed
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const literal = coerceIpv4Literal(host);
  if (literal && isBlockedIp(literal)) return true;
  if (net.isIPv6(host.replace(/^\[|\]$/g, "")) && isBlockedIp(host)) return true;
  return false;
}

/**
 * Parse and validate a URL for outbound fetch: http(s) only, no credentials,
 * blocked hosts/IPs denied, DNS answers re-checked (rebinding-aware).
 */
export async function assertSafeFetchUrl(
  urlString: string,
  lookup: DnsLookup = defaultLookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new SsrfError("invalid_url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("non_http_scheme");
  }
  if (url.username || url.password) {
    throw new SsrfError("credentials_in_url");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname || isBlockedHostname(hostname)) {
    throw new SsrfError("blocked_hostname");
  }

  const literal = coerceIpv4Literal(hostname) ?? (net.isIP(hostname) ? hostname : null);
  if (literal) {
    if (isBlockedIp(literal)) throw new SsrfError("blocked_ip");
    return url;
  }

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new SsrfError("dns_failed");
  }
  if (!addresses.length) throw new SsrfError("dns_failed");
  for (const address of addresses) {
    if (isBlockedIp(address)) throw new SsrfError("blocked_resolved_ip");
  }
  return url;
}
