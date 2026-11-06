const nibieRouter = "https://router.nibie.app/v1";

function isBlockedIp(host: string): boolean {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd");
  const [a, b] = ipv4.slice(1).map(Number);
  if ([a, b].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function assertProviderBaseUrl(providerType: "nibie_router" | "openai_compatible", baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (providerType === "nibie_router") {
    if (trimmed !== nibieRouter) throw new Error("Nibie Router must use https://router.nibie.app/v1.");
    return trimmed;
  }
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error("Base URL must be a valid URL."); }
  if (url.protocol !== "https:") throw new Error("Base URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Base URL must not include credentials.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || isBlockedIp(host)) {
    throw new Error("Base URL host is not allowed.");
  }
  return trimmed;
}
