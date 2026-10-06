import { describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabaseUrl } from "../../lib/config/test-database";

const localUrl = "postgres://postgres@127.0.0.1:55439/nibie_ai";

describe("assertSafeIntegrationDatabaseUrl", () => {
  it("allows explicit destructive tests only for the named local test database", () => {
    expect(() => assertSafeIntegrationDatabaseUrl(localUrl, "1")).not.toThrow();
  });

  it("rejects a remote database even when it has the test database name", () => {
    expect(() =>
      assertSafeIntegrationDatabaseUrl("postgres://user@project.supabase.co/nibie_ai", "1"),
    ).toThrow(/loopback/);
  });

  it("requires an explicit reset opt-in", () => {
    expect(() => assertSafeIntegrationDatabaseUrl(localUrl, undefined)).toThrow(/ALLOW_TEST_DATABASE_RESET/);
  });

  it("rejects a local database with any other name", () => {
    expect(() => assertSafeIntegrationDatabaseUrl("postgres://postgres@127.0.0.1/workspace", "1")).toThrow(
      /nibie_ai/,
    );
  });

  it("rejects malformed or non-PostgreSQL URLs", () => {
    expect(() => assertSafeIntegrationDatabaseUrl("not-a-url", "1")).toThrow(/valid PostgreSQL URL/);
    expect(() => assertSafeIntegrationDatabaseUrl("https://localhost/nibie_ai", "1")).toThrow(
      /valid PostgreSQL URL/,
    );
  });
});
