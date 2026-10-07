import { describe, expect, it } from "vitest";
import { draftFromSaveBody, extractDurableStatement } from "../../lib/recall/normalize";
import { memoryTopicKey } from "../../lib/recall/topic";

describe("memory topic identity", () => {
  it("groups Cedar database facts for replacement", () => {
    const a = draftFromSaveBody("Project Cedar uses MySQL")!;
    const b = draftFromSaveBody("Project Cedar now uses PostgreSQL")!;
    expect(memoryTopicKey(a.type, a.content)).toBe("project:cedar:database");
    expect(memoryTopicKey(b.type, b.content)).toBe("project:cedar:database");
    expect(a.normalizedKey).not.toBe(b.normalizedKey);
  });

  it("groups code-example preferences for replacement", () => {
    const a = draftFromSaveBody("I prefer JavaScript examples")!;
    const b = draftFromSaveBody("I prefer TypeScript examples")!;
    expect(memoryTopicKey(a.type, a.content)).toBe("preference:code_examples");
    expect(memoryTopicKey(b.type, b.content)).toBe("preference:code_examples");
  });

  it("returns null when identity is ambiguous", () => {
    const draft = draftFromSaveBody("Remember that the office has a red door")!;
    // Without remember prefix:
    const plain = draftFromSaveBody("The office has a red door")!;
    expect(memoryTopicKey(plain.type, plain.content)).toBeNull();
    expect(draft).toBeTruthy();
  });
});

describe("Indonesian forget wrappers", () => {
  it("strips bahwa and tentang from forget bodies", () => {
    expect(extractDurableStatement("bahwa saya lebih suka jawaban singkat")).toBe("saya lebih suka jawaban singkat");
    expect(extractDurableStatement("bahwa Project Cedar menggunakan PostgreSQL")).toBe("Project Cedar menggunakan PostgreSQL");
    expect(extractDurableStatement("tentang TypeScript examples")).toBe("TypeScript examples");
  });
});
