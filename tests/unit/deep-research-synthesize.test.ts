import { describe, expect, it } from "vitest";
import { researchSynthesisInstruction } from "@/lib/research/synthesize";
import type { SourceReference } from "@/lib/citations/types";

describe("researchSynthesisInstruction", () => {
  it("includes citation rules when sources exist", () => {
    const sources: SourceReference[] = [
      {
        id: "web:1",
        kind: "web",
        title: "Docs",
        url: "https://example.com",
        domain: "example.com",
      },
    ];
    const text = researchSynthesisInstruction({
      plan: {
        normalizedQuestion: "Q",
        subquestions: [],
        initialQueries: ["q"],
        timeSensitive: false,
        notes: "",
      },
      sources,
      contradictions: [{ topic: "pricing", summary: "prices differ" }],
      incompleteNotice: null,
    });
    expect(text).toContain("[SOURCE:web:1]");
    expect(text).toMatch(/pricing/);
  });
});
