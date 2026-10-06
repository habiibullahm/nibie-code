import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/health/route";
import { operationalCodes } from "../../lib/observability/codes";
import { buildLogRecord, logError, logInfo, sanitizeLogFields } from "../../lib/observability/logger";
import { publicHealthRelease, readReleaseIdentity } from "../../lib/observability/release";
import { resolveRequestId } from "../../lib/observability/request-id";

const production = {
  VERCEL_GIT_COMMIT_SHA: "abc1234def567890",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_ENV: "production",
};

describe("release identity", () => {
  it("uses the Vercel commit instead of a package version", () => {
    expect(readReleaseIdentity({ ...production, npm_package_version: "9.9.9" })).toEqual({
      sha: "abc1234def567890",
      shortSha: "abc1234",
      branch: "main",
      environment: "production",
    });
  });

  it("falls back for local development and drops unsafe metadata", () => {
    expect(readReleaseIdentity({})).toEqual({
      sha: "local",
      shortSha: "local",
      branch: "local",
      environment: "development",
    });
    expect(readReleaseIdentity({
      VERCEL_GIT_COMMIT_SHA: "not a commit",
      VERCEL_GIT_COMMIT_REF: "feature/staging-v1",
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgres://user:password@db.example/nibie",
    })).toEqual({
      sha: "local",
      shortSha: "local",
      branch: "feature/staging-v1",
      environment: "preview",
    });
    expect(readReleaseIdentity({ VERCEL_GIT_COMMIT_REF: "main; drop table", VERCEL_ENV: "staging" })).toMatchObject({
      branch: "local",
      environment: "development",
    });
  });

  it("keeps the public health payload free of branch and secrets", () => {
    expect(publicHealthRelease(production)).toEqual({ status: "ok", release: "abc1234", environment: "production" });
    expect(publicHealthRelease(production)).not.toHaveProperty("branch");
    expect(publicHealthRelease(production)).not.toHaveProperty("sha");
  });
});

describe("structured logger", () => {
  it("adds release metadata and keeps operational fields", () => {
    expect(buildLogRecord("info", "context.built", {
      requestId: "icn1::abc123request",
      durationMs: 12,
      profileIncluded: false,
      pinCount: 3,
    }, production)).toMatchObject({
      event: "context.built",
      release: "abc1234",
      sha: "abc1234def567890",
      branch: "main",
      environment: "production",
      level: "info",
      requestId: "icn1::abc123request",
      durationMs: 12,
      profileIncluded: false,
      pinCount: 3,
    });
  });

  it("does not keep secrets, message content, or nested user data", () => {
    const fields = sanitizeLogFields({
      authorization: "Bearer super-secret-token",
      cookie: "sb-access-token=secret-cookie",
      email: "person@example.com",
      content: "private assistant response",
      prompt: "hidden prompt",
      instructions: "room instructions",
      pins: ["secret project decision"],
      profile: "about the user",
      note: "reach me at person@example.com",
      tokenValue: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLogThisSignature",
      pinCount: 3,
      code: operationalCodes.aiProviderFailed,
    });
    const serialized = JSON.stringify(fields);
    expect(fields).toEqual({ pinCount: 3, code: operationalCodes.aiProviderFailed });
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("secret-cookie");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("private assistant");
    expect(serialized).not.toContain("hidden prompt");
    expect(serialized).not.toContain("secret project");
    expect(serialized).not.toContain("eyJhbGciOi");
  });

  it("writes one json line without snapshotting the timestamp", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      logError("chat.response.failed", { requestId: "req-12345678", content: "do not log", code: operationalCodes.aiProviderFailed });
      expect(error).toHaveBeenCalledOnce();
      const record = JSON.parse(String(error.mock.calls[0]?.[0])) as { time?: string; content?: string; event?: string };
      expect(record.event).toBe("chat.response.failed");
      expect(record.content).toBeUndefined();
      expect(record.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      error.mockRestore();
    }
  });

  it("emits snake_case event segments and drops malformed event names", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      logInfo("thread_summary.refresh.completed", { requestId: "req-12345678" });
      logInfo("Thread Summary!", { requestId: "req-12345678" });
      expect(info).toHaveBeenCalledOnce();
      expect(JSON.parse(String(info.mock.calls[0]?.[0])).event).toBe("thread_summary.refresh.completed");
    } finally {
      info.mockRestore();
    }
  });
});

describe("request ids", () => {
  it("keeps an opaque vercel id and otherwise generates one", () => {
    expect(resolveRequestId("icn1::abc123request")).toBe("icn1::abc123request");
    expect(resolveRequestId("person@example.com")).not.toContain("@");
    expect(resolveRequestId("short")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("GET /api/health", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the safe release payload", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc1234def567890");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:password@db.example/nibie");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ status: "ok", release: "abc1234", environment: "production" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("postgres");
    expect(serialized).not.toContain("main");
  });
});
