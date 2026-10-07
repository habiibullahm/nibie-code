import { describe, expect, it } from "vitest";
import { buildNormalizedKey, classifyMemoryType, draftFromSaveBody, normalizeMemoryContent } from "../../lib/recall/normalize";

describe("memory normalize and classify", () => {
  it("normalizes content and builds a stable key", () => {
    expect(normalizeMemoryContent("  I prefer TypeScript.  ")).toBe("I prefer TypeScript.");
    expect(buildNormalizedKey("I prefer TypeScript.")).toBe("i prefer typescript");
    expect(buildNormalizedKey("I prefer TypeScript!")).toBe(buildNormalizedKey("i prefer typescript"));
  });

  it("classifies preference, instruction, project, and fact", () => {
    expect(classifyMemoryType("I prefer TypeScript strict mode")).toBe("preference");
    expect(classifyMemoryType("Always answer in Bahasa Indonesia")).toBe("instruction");
    expect(classifyMemoryType("Nibie production deploy is in Seoul")).toBe("project");
    expect(classifyMemoryType("My birthday is in March")).toBe("fact");
  });

  it("builds a draft for save bodies", () => {
    const draft = draftFromSaveBody("I prefer TypeScript", {
      conversationId: "5e9bdcca-9205-4fea-a773-13952bb78c44",
      messageId: "b79e56e1-b479-46f4-97d3-30b2e22be90e",
    });
    expect(draft).toMatchObject({
      type: "preference",
      content: "I prefer TypeScript",
      normalizedKey: "i prefer typescript",
      sourceConversationId: "5e9bdcca-9205-4fea-a773-13952bb78c44",
    });
  });

  it("rejects empty or oversized content", () => {
    expect(normalizeMemoryContent("   ")).toBeNull();
    expect(normalizeMemoryContent("x".repeat(1001))).toBeNull();
  });
});
