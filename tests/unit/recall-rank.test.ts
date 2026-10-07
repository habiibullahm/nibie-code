import { describe, expect, it } from "vitest";
import { extractIdentifiers, rankMemories } from "../../lib/recall/rank";
import type { MemoryRecord } from "../../lib/recall/types";

function memory(overrides: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "content">): MemoryRecord {
  return {
    type: "fact",
    normalizedKey: overrides.content.toLowerCase(),
    sourceConversationId: null,
    sourceMessageId: null,
    isActive: true,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

describe("memory ranking", () => {
  it("boosts exact identifiers ahead of loose lexical matches", () => {
    const ranked = rankMemories("How do we deploy NIBIE_V1?", [
      memory({ id: "a", content: "I like short answers", type: "preference" }),
      memory({ id: "b", content: "NIBIE_V1 deploys to Seoul", type: "project" }),
      memory({ id: "c", content: "Deploy uses blue-green", type: "project" }),
    ], 5);
    expect(ranked.map((item) => item.id)).toEqual(["b", "c"]);
    expect(ranked[0].exactIdentifier).toBe(true);
  });

  it("skips irrelevant memories", () => {
    const ranked = rankMemories("What is the capital of France?", [
      memory({ id: "a", content: "I prefer TypeScript", type: "preference" }),
      memory({ id: "b", content: "Production DB is read-only", type: "project" }),
    ], 5);
    expect(ranked).toEqual([]);
  });

  it("does not treat stopword overlap as relevance", () => {
    expect(rankMemories("where is the office?", [
      memory({ id: "a", content: "The production database is read-only", type: "project" }),
    ], 5)).toEqual([]);
  });

  it("extracts identifiers from queries", () => {
    expect(extractIdentifiers("Check REST_API and v1.2.3")).toEqual(expect.arrayContaining(["rest_api", "v1.2.3"]));
  });

  it("prefers instructions for coding queries", () => {
    const ranked = rankMemories("Fix this TypeScript function", [
      memory({ id: "fact", content: "TypeScript is used here", type: "fact" }),
      memory({ id: "inst", content: "Always use strict TypeScript", type: "instruction" }),
    ], 5);
    expect(ranked[0].id).toBe("inst");
  });
});
