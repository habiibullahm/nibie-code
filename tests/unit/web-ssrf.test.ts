import { describe, expect, it, vi } from "vitest";
import { fetchWebPage, WebFetchError } from "@/lib/web/fetch-page";
import {
  assertSafeFetchUrl,
  coerceIpv4Literal,
  isBlockedHostname,
  isBlockedIp,
  SsrfError,
} from "@/lib/web/ssrf";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.1",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.1.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456:789a::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.0.1",
    "::ffff:169.254.169.254",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888"])(
    "allows public %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe("isBlockedHostname", () => {
  it.each([
    "localhost",
    "metadata.google.internal",
    "foo.local",
    "svc.internal",
    "127.0.0.1",
    "192.168.0.2",
  ])("blocks hostname %s", (host) => {
    expect(isBlockedHostname(host)).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("docs.tavily.com")).toBe(false);
  });
});

describe("coerceIpv4Literal", () => {
  it("expands integer and short forms used in SSRF tricks", () => {
    expect(coerceIpv4Literal("2130706433")).toBe("127.0.0.1");
    expect(coerceIpv4Literal("127.1")).toBe("127.0.0.1");
  });
});

describe("assertSafeFetchUrl", () => {
  const publicLookup = vi.fn(async () => ["93.184.216.34"]);

  it("rejects non-http schemes", async () => {
    await expect(assertSafeFetchUrl("file:///etc/passwd", publicLookup)).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(assertSafeFetchUrl("ftp://example.com/a", publicLookup)).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(assertSafeFetchUrl("javascript:alert(1)", publicLookup)).rejects.toBeInstanceOf(
      SsrfError,
    );
    expect(publicLookup).not.toHaveBeenCalled();
  });

  it("rejects localhost and loopback literals without DNS", async () => {
    await expect(assertSafeFetchUrl("http://127.0.0.1/", publicLookup)).rejects.toMatchObject({
      category: "ssrf_blocked",
    });
    await expect(assertSafeFetchUrl("http://localhost/", publicLookup)).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(assertSafeFetchUrl("http://[::1]/", publicLookup)).rejects.toBeInstanceOf(
      SsrfError,
    );
    expect(publicLookup).not.toHaveBeenCalled();
  });

  it("rejects RFC1918 and cloud metadata hosts", async () => {
    await expect(assertSafeFetchUrl("http://10.0.0.5/secret", publicLookup)).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(
      assertSafeFetchUrl("http://169.254.169.254/latest/meta-data/", publicLookup),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertSafeFetchUrl("http://metadata.google.internal/", publicLookup),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects credentials in URL", async () => {
    await expect(
      assertSafeFetchUrl("https://user:pass@example.com/", publicLookup),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("allows public https after DNS confirms public addresses", async () => {
    const url = await assertSafeFetchUrl("https://example.com/path", publicLookup);
    expect(url.hostname).toBe("example.com");
    expect(publicLookup).toHaveBeenCalledWith("example.com");
  });

  it("blocks when DNS resolves to a private address (rebinding)", async () => {
    const rebinding = vi.fn(async () => ["8.8.8.8", "127.0.0.1"]);
    await expect(assertSafeFetchUrl("https://evil.example/", rebinding)).rejects.toMatchObject({
      message: "blocked_resolved_ip",
    });
  });

  it("blocks when DNS resolves only to link-local metadata", async () => {
    const meta = vi.fn(async () => ["169.254.169.254"]);
    await expect(assertSafeFetchUrl("https://sneaky.test/", meta)).rejects.toBeInstanceOf(
      SsrfError,
    );
  });
});

describe("fetchWebPage SSRF + bounds", () => {
  const publicLookup = async () => ["93.184.216.34"];

  it("re-validates redirect targets and blocks private hops", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
      );
    await expect(
      fetchWebPage("https://example.com/start", {
        signal: AbortSignal.timeout(5_000),
        lookup: publicLookup,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: "ssrf_blocked" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects disallowed content types", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(
      fetchWebPage("https://example.com/data", {
        signal: AbortSignal.timeout(5_000),
        lookup: publicLookup,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: "content_type" });
  });

  it("enforces response size limit", async () => {
    const big = "x".repeat(1000);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(big, { status: 200, headers: { "content-type": "text/plain" } }),
    );
    await expect(
      fetchWebPage("https://example.com/big", {
        signal: AbortSignal.timeout(5_000),
        lookup: publicLookup,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(WebFetchError);
  });

  it("returns body for allowed HTML", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<p>ok</p>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    const page = await fetchWebPage("https://example.com/ok", {
      signal: AbortSignal.timeout(5_000),
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(page.body).toContain("ok");
    expect(page.contentType).toBe("text/html");
  });
});
