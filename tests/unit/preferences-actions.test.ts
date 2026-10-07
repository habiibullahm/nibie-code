import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, modelOptions } = vi.hoisted(() => ({ createClient: vi.fn(), modelOptions: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/ai/registry", () => ({ getModelOptions: modelOptions }));

import { getPreferencesAction, updatePreferencesAction } from "../../app/actions/preferences";
import { defaultUserPreferences } from "../../lib/preferences/types";

type PreferenceRow = {
  preferred_name: string | null;
  preferred_language: string;
  default_model: string;
  response_length: string;
  response_style: string;
  about_you: string | null;
  recall_enabled: boolean;
  created_at: string;
  updated_at: string;
};

function memoryClient(owner = "owner") {
  let row: PreferenceRow | null = null;
  const tables: string[] = [];
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: owner } }, error: null }) },
    from: (table: string) => {
      tables.push(table);
      return {
        select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        upsert: (patch: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const next: PreferenceRow = {
                preferred_name: row?.preferred_name ?? null,
                preferred_language: row?.preferred_language ?? "auto",
                default_model: row?.default_model ?? "balanced",
                response_length: row?.response_length ?? "balanced",
                response_style: row?.response_style ?? "natural",
                about_you: row?.about_you ?? null,
                recall_enabled: row?.recall_enabled ?? true,
                created_at: row?.created_at ?? "2026-10-02T00:00:00.000Z",
                updated_at: "2026-10-02T00:00:01.000Z",
              };
              if ("preferred_name" in patch) next.preferred_name = patch.preferred_name as string | null;
              if ("preferred_language" in patch) next.preferred_language = String(patch.preferred_language);
              if ("default_model" in patch) next.default_model = String(patch.default_model);
              if ("response_length" in patch) next.response_length = String(patch.response_length);
              if ("response_style" in patch) next.response_style = String(patch.response_style);
              if ("about_you" in patch) next.about_you = patch.about_you as string | null;
              if ("recall_enabled" in patch) next.recall_enabled = Boolean(patch.recall_enabled);
              if (patch.user_id !== owner) throw new Error("owner mismatch");
              row = next;
              return { data: next, error: null };
            },
          }),
        }),
      };
    },
  };
  return { client, tables, read: () => row };
}

describe("preference read and write", () => {
  beforeEach(() => {
    createClient.mockReset();
    modelOptions.mockReset().mockReturnValue({ models: [{ id: "Fast" }, { id: "Balanced" }] });
  });

  it("returns defaults when the owner has no row", async () => {
    const { client } = memoryClient();
    createClient.mockResolvedValue(client);
    await expect(getPreferencesAction()).resolves.toEqual({ preferences: defaultUserPreferences(), error: null });
  });

  it("rejects invalid enums and a supplied owner before opening a client", async () => {
    await expect(updatePreferencesAction({ defaultModel: "turbo" })).resolves.toMatchObject({ error: "Choose a valid preference." });
    await expect(updatePreferencesAction({ user_id: "someone-else", preferredLanguage: "en" })).resolves.toMatchObject({ error: "Choose a valid preference." });
    await expect(updatePreferencesAction({ preferredLanguage: "fr" })).resolves.toMatchObject({ error: "Choose a valid preference." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a default model that is not configured", async () => {
    await expect(updatePreferencesAction({ defaultModel: "reasoning" })).resolves.toEqual({ preferences: defaultUserPreferences(), error: "That model isn't available." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("persists a patch for the signed-in owner and reads it back", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    const saved = await updatePreferencesAction({ preferredLanguage: "en", defaultModel: "fast", preferredName: "  Habib " });
    expect(saved.error).toBeNull();
    expect(saved.preferences).toMatchObject({ preferredLanguage: "en", defaultModel: "fast", preferredName: "Habib", responseStyle: "natural" });
    await expect(getPreferencesAction()).resolves.toEqual({ preferences: saved.preferences, error: null });
    expect(memory.tables.every((table) => table === "user_preferences")).toBe(true);
    expect(memory.read()?.preferred_language).toBe("en");
  });

  it("does not leak a database error", async () => {
    createClient.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) },
      from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "relation user_preferences does not exist" } }) }) }),
    });
    const result = await getPreferencesAction();
    expect(result.preferences).toEqual(defaultUserPreferences());
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("user_preferences");
  });
});
