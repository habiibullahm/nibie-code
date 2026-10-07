import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { draftFromSaveBody } from "../../lib/recall/normalize";
import {
  deactivateMatchingMemories,
  listOwnerMemoriesAll,
  listOwnerMemoriesForRetrieval,
  listOwnerMemoriesPage,
  upsertMemoryByKey,
} from "../../lib/recall/store";
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

function memoryClient(seed: Row[] = []) {
  const rows = seed;
  const sorted = () => [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));

  function filtered(activeOnly?: boolean) {
    const list = sorted();
    if (activeOnly === true) return list.filter((row) => row.is_active);
    if (activeOnly === false) return list.filter((row) => !row.is_active);
    return list;
  }

  const client = {
    from: (table: string) => {
      if (table !== "memories") throw new Error(`unexpected table ${table}`);
      return {
        select: () => {
          let activeOnly: boolean | undefined;
          const api = {
            eq(column: string, value: unknown) {
              if (column === "is_active") activeOnly = Boolean(value);
              return api;
            },
            order() {
              return api;
            },
            limit(count: number) {
              return Promise.resolve({ data: filtered(activeOnly).slice(0, count), error: null });
            },
            range(from: number, to: number) {
              return Promise.resolve({ data: filtered(activeOnly).slice(from, to + 1), error: null });
            },
          };
          return api;
        },
        upsert: (patch: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const key = String(patch.normalized_key);
              const existing = rows.find((row) => row.normalized_key === key);
              const next: Row = {
                id: existing?.id ?? crypto.randomUUID(),
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
                return { data: row, error: null };
              },
            }),
          }),
        }),
      };
    },
  };
  return { client: client as never, rows };
}

describe("memory store dedupe and listing", () => {
  it("upserts by normalized key and updates content", async () => {
    const { client, rows } = memoryClient();
    const draft: MemoryDraft = {
      type: "preference",
      content: "I prefer TypeScript",
      normalizedKey: "i prefer typescript",
    };
    const first = await upsertMemoryByKey(client, "owner", draft);
    expect(first.memory?.content).toBe("I prefer TypeScript");
    const second = await upsertMemoryByKey(client, "owner", {
      ...draft,
      content: "I prefer TypeScript for APIs",
      normalizedKey: "i prefer typescript for apis",
    });
    expect(second.error).toBeNull();
    // Same preference topic → prior row deactivated.
    expect(rows.filter((row) => row.is_active)).toHaveLength(1);
  });

  it("replaces conflicting Cedar database memories via real normalization", async () => {
    const { client, rows } = memoryClient();
    const mysql = draftFromSaveBody("Project Cedar uses MySQL");
    const postgres = draftFromSaveBody("Project Cedar now uses PostgreSQL");
    expect(mysql && postgres).toBeTruthy();
    await upsertMemoryByKey(client, "owner", mysql!);
    await upsertMemoryByKey(client, "owner", postgres!);
    const active = rows.filter((row) => row.is_active);
    expect(active).toHaveLength(1);
    expect(active[0].content.toLowerCase()).toContain("postgresql");
  });

  it("replaces conflicting code-example preferences via real normalization", async () => {
    const { client, rows } = memoryClient();
    const js = draftFromSaveBody("I prefer JavaScript examples");
    const ts = draftFromSaveBody("I prefer TypeScript examples");
    expect(js && ts).toBeTruthy();
    await upsertMemoryByKey(client, "owner", js!);
    await upsertMemoryByKey(client, "owner", ts!);
    const active = rows.filter((row) => row.is_active);
    expect(active).toHaveLength(1);
    expect(active[0].content.toLowerCase()).toContain("typescript");
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

  it("forgets Indonesian phrases after stripping bahwa", async () => {
    const { client, rows } = memoryClient([{
      id: "11111111-1111-4111-8111-111111111111",
      type: "preference",
      content: "Saya lebih suka jawaban singkat",
      normalized_key: "saya lebih suka jawaban singkat",
      source_conversation_id: null,
      source_message_id: null,
      is_active: true,
      created_at: "2026-10-07T00:00:00.000Z",
      updated_at: "2026-10-07T00:00:00.000Z",
      last_used_at: null,
    }]);
    const result = await deactivateMatchingMemories(client, "bahwa saya lebih suka jawaban singkat");
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

  it("keeps retrieval capped while Settings/forget can reach beyond 80", async () => {
    const seed: Row[] = Array.from({ length: 85 }, (_, index) => {
      const n = String(index).padStart(3, "0");
      const isCedar = index === 0;
      return {
        id: `00000000-0000-4000-8000-${n.padStart(12, "0")}`,
        type: isCedar ? "project" : "fact",
        content: isCedar ? "Project Cedar uses PostgreSQL" : `Filler memory number ${n}`,
        normalized_key: isCedar ? "project cedar uses postgresql" : `filler memory number ${n}`,
        source_conversation_id: null,
        source_message_id: null,
        is_active: true,
        created_at: "2026-10-07T00:00:00.000Z",
        updated_at: `2026-10-07T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
        last_used_at: null,
      };
    });
    const { client, rows } = memoryClient(seed);

    const retrieval = await listOwnerMemoriesForRetrieval(client, { activeOnly: true });
    expect(retrieval.error).toBeNull();
    expect(retrieval.memories).toHaveLength(80);
    expect(retrieval.memories.some((memory) => memory.content.includes("Cedar"))).toBe(false);

    const all = await listOwnerMemoriesAll(client, { activeOnly: true });
    expect(all.memories).toHaveLength(85);
    expect(all.memories.some((memory) => memory.content.includes("Cedar"))).toBe(true);

    const page = await listOwnerMemoriesPage(client, { offset: 80, limit: 50, activeOnly: true });
    expect(page.memories.some((memory) => memory.content.includes("Cedar"))).toBe(true);

    const forgot = await deactivateMatchingMemories(client, "Project Cedar uses PostgreSQL");
    expect(forgot.count).toBe(1);
    expect(rows.find((row) => row.content.includes("Cedar"))?.is_active).toBe(false);
  });
});
