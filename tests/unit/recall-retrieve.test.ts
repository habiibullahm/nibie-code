import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { retrieveRelevantMemories } from "../../lib/recall/retrieve";

type MemoryRow = {
  id: string;
  type: "preference" | "project" | "instruction" | "fact";
  content: string;
  normalized_key: string;
  source_conversation_id: null;
  source_message_id: null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: null;
};

const row: MemoryRow = {
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
};

function client(options?: { failList?: boolean; rows?: MemoryRow[] }) {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => ({
            limit: () => ({
              eq: async () => options?.failList
                ? { data: null, error: { message: "fail" } }
                : { data: options?.rows ?? [row], error: null },
              then: (resolve: (value: unknown) => unknown) => Promise.resolve({
                data: options?.failList ? null : (options?.rows ?? [row]),
                error: options?.failList ? { message: "fail" } : null,
              }).then(resolve),
            }),
          }),
        }),
      }),
      update: () => ({
        in: async () => ({ data: null, error: null }),
      }),
    }),
    rpc: async () => ({ data: [], error: null }),
  } as never;
}

describe("memory retrieval", () => {
  it("returns relevant memories and skips irrelevant ones", async () => {
    const relevant = await retrieveRelevantMemories({
      supabase: client(),
      query: "Should I use TypeScript here?",
      recallEnabled: true,
    });
    expect(relevant.memories.map((memory) => memory.content)).toEqual(["I prefer TypeScript"]);

    const irrelevant = await retrieveRelevantMemories({
      supabase: client(),
      query: "What is the capital of France?",
      recallEnabled: true,
    });
    expect(irrelevant.memories).toEqual([]);
  });

  it("returns empty when recall is disabled", async () => {
    const result = await retrieveRelevantMemories({
      supabase: client(),
      query: "TypeScript preference?",
      recallEnabled: false,
    });
    expect(result).toEqual({ memories: [], degraded: false });
  });

  it("soft-fails when the store errors", async () => {
    const result = await retrieveRelevantMemories({
      supabase: client({ failList: true }),
      query: "TypeScript",
      recallEnabled: true,
    });
    expect(result).toEqual({ memories: [], degraded: true });
  });

  it("boosts exact identifiers", async () => {
    const rows = [
      row,
      {
        ...row,
        id: "22222222-2222-4222-8222-222222222222",
        type: "project" as const,
        content: "NIBIE_V1 deploys to Seoul",
        normalized_key: "nibie_v1 deploys to seoul",
      },
    ];
    const result = await retrieveRelevantMemories({
      supabase: client({ rows }),
      query: "Where does NIBIE_V1 deploy?",
      recallEnabled: true,
    });
    expect(result.memories[0]?.content).toContain("NIBIE_V1");
    expect(result.memories[0]?.exactIdentifier).toBe(true);
  });
});
