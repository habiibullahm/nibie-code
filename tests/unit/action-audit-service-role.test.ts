import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createClient = vi.hoisted(() => vi.fn(() => ({ rpc: vi.fn() })));

vi.mock("@supabase/supabase-js", () => ({
  createClient,
}));

import { createActionAuditClient } from "@/lib/supabase/service-role";
import { resolveActionAuditClient } from "@/lib/actions/audit";

function serviceRoleJwt() {
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  return `hdr.${payload}.sig`;
}

describe("Action audit service-role client", () => {
  afterEach(() => {
    createClient.mockClear();
  });

  it("returns null when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    expect(
      createActionAuditClient({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-anon-key",
      }),
    ).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a publishable key placed in the service-role slot", () => {
    expect(
      createActionAuditClient({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "public-anon-key",
      }),
    ).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("builds a non-persistent client for service-role JWT material", () => {
    const key = serviceRoleJwt();
    const client = createActionAuditClient({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: key,
    });
    expect(client).toBeTruthy();
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      key,
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
        }),
      }),
    );
  });

  it("prefers the env service-role client over a caller-supplied fallback", () => {
    const key = serviceRoleJwt();
    const preferred = { tag: "preferred" } as never;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", key);
    const resolved = resolveActionAuditClient(preferred);
    expect(resolved).not.toBe(preferred);
    expect(createClient).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("falls back to the caller client when no service-role key is configured", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const preferred = { tag: "preferred" } as never;
    expect(resolveActionAuditClient(preferred)).toBe(preferred);
    vi.unstubAllEnvs();
  });
});
