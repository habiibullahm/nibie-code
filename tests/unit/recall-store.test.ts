import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deactivateMatchingMemories, upsertMemoryByKey } from "../../lib/recall/store";
import type { MemoryDraft } from "../../lib/recall/types";

type Row = {
  id: string;
  type: string;
  content: string;
  normalized_key: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

function thenable(result: { data: unknown; error: unknown }) {
  return {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    eq: (column: string, value: unknown) => {
      const rows = Array.isArray(result.data) ? result.data as Row[] : [];
      const filtered = column === "is_active" ? rows.filter((row) => row.is_active === value) : rows;
      return thenable({ data: filtered, error: null });
    },
  };
}

function memoryClient(seed: Row[] = []) {
  const rows = seed;
  const client = {
    from: (table: string) => {
      if (table !== "memories") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          order: () => ({
            order: () => ({
              limit: () => thenable({ data: rows, error: null }),
            }),
          }),
        }),
        upsert: (patch: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const key = String(patch.normalized_key);
              const existing = rows.find((row) => row.normalized_key === key);
              const next: Row = {
                id: existing?.id ?? "11111111-1111-4111-8111-111111111111",
                type: String(patch.type),
                content: String(patch.content),
                normalized_key: key,
                source_conversation_id: (patch.source_conversation_id as string | null) ?? null,
                source_message_id: (patch.source_message_id as string | null) ?? null,
                is_active: true,
                created_at: existing?.created_at ?? "2026-10-07T00:00:00.000Z",
                updated_at: "2026-10-07T00:00:01.000Z",
                last_used_at: null,
              };
              if (existing) Object.assign(existing, next);
              else rows.push(next);
              return { data: next, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_column: string, value: string) => ({
            select: () => ({
              maybeSingle: async () => {
                const row = rows.find((item) => item.id === value);
                if (!row) return { data: null, error: null };
                Object.assign(row, patch);
                return { data: { id: row.id }, error: null };
              },
            }),
          }),
        }),
      };
    },
  };
  return { client: client as never, rows };
}

describe("memory store dedupe", () => {
  it("upserts by normalized key and updates content", async () => {
    const { client, rows } = memoryClient();
    const draft: MemoryDraft = {
      type: "preference",
      content: "I prefer TypeScript",
      normalizedKey: "i prefer typescript",
    };
    const first = await upsertMemoryByKey(client, "owner", draft);
    expect(first.memory?.content).toBe("I prefer TypeScript");
    const second = await upsertMemoryByKey(client, "owner", { ...draft, content: "I prefer TypeScript strict" });
    expect(second.memory?.content).toBe("I prefer TypeScript strict");
    expect(rows).toHaveLength(1);
    expect(rows[0].is_active).toBe(true);
  });

  it("deactivates matching memories on forget", async () => {
    const { client, rows } = memoryClient([{
      id: "11111111-1111-4111-8111-111111111111",
      type: "preference",
      content: "I prefer TypeScript",
      normalized_key: "i prefer typescript",
      source_conversation_id: null,
      source_message_id: null,
      is_active: true,
      created_at: "2026-10-07T00:00:00.000Z",
      updated_at: "2026-10-07T00:00:00.000Z",
      last_used_at: null,
    }]);
    const result = await deactivateMatchingMemories(client, "I prefer TypeScript");
    expect(result.error).toBeNull();
    expect(result.count).toBe(1);
    expect(rows[0].is_active).toBe(false);
  });

  it("does not forget unrelated memories from a short needle", async () => {
    const { client, rows } = memoryClient([
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: "preference",
        content: "I prefer TypeScript",
        normalized_key: "i prefer typescript",
        source_conversation_id: null,
        source_message_id: null,
        is_active: true,
        created_at: "2026-10-07T00:00:00.000Z",
        updated_at: "2026-10-07T00:00:00.000Z",
        last_used_at: null,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "project",
        content: "Project Cedar uses PostgreSQL",
        normalized_key: "project cedar uses postgresql",
        source_conversation_id: null,
        source_message_id: null,
        is_active: true,
        created_at: "2026-10-07T00:00:00.000Z",
        updated_at: "2026-10-07T00:00:00.000Z",
        last_used_at: null,
      },
    ]);
    const result = await deactivateMatchingMemories(client, "I");
    expect(result.count).toBe(0);
    expect(rows.every((row) => row.is_active)).toBe(true);
  });
});
