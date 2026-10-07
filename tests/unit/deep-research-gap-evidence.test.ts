import { describe, expect, it } from "vitest";
import { detectContradictions, extractEvidenceChunk } from "@/lib/research/evidence";
import { detectResearchGaps } from "@/lib/research/gap";
import { RESEARCH_EVIDENCE_CHARS_MAX, RESEARCH_MAX_FOLLOWUP_QUERIES } from "@/lib/research/budgets";
import type { ResearchEvidenceChunk, ResearchPlan } from "@/lib/research/types";

const plan = (partial: Partial<ResearchPlan> = {}): ResearchPlan => ({
  normalizedQuestion: "Compare pricing and benchmarks",
  subquestions: ["pricing", "benchmarks", "regulation"],
  initialQueries: ["pricing", "benchmarks"],
  timeSensitive: true,
  notes: "",
  ...partial,
});

describe("deep research evidence and gaps", () => {
  it("bounds evidence chunk length", () => {
    const chunk = extractEvidenceChunk({
      url: "https://a.example",
      title: "A",
      domain: "a.example",
      retrieval: "web_search",
      text: "x".repeat(10_000),
    });
    expect(chunk.text.length).toBeLessThanOrEqual(RESEARCH_EVIDENCE_CHARS_MAX + 1);
  });

  it("surfaces material disagreement topics across domains", () => {
    const chunks: ResearchEvidenceChunk[] = [
      {
        url: "https://a.example/p",
        title: "A pricing",
        domain: "a.example",
        text: "Pro plan price is $20 with benchmark score 90",
        retrieval: "web_search",
      },
      {
        url: "https://b.example/p",
        title: "B pricing",
        domain: "b.example",
        text: "Pro plan price is $35; independent benchmark score 70",
        retrieval: "web_search",
      },
    ];
    const contradictions = detectContradictions(chunks);
    expect(contradictions.some((c) => c.topic === "pricing" || c.topic === "benchmarks")).toBe(true);
  });

  it("requests at most one follow-up round with ≤4 queries when coverage is thin", () => {
    const gap = detectResearchGaps(plan(), [
      {
        url: "https://a.example",
        title: "thin",
        domain: "a.example",
        text: "unrelated text",
        retrieval: "web_snippet_only",
      },
    ]);
    expect(gap.needsFollowUp).toBe(true);
    expect(gap.followUpQueries.length).toBeGreaterThan(0);
    expect(gap.followUpQueries.length).toBeLessThanOrEqual(RESEARCH_MAX_FOLLOWUP_QUERIES);
  });

  it("skips follow-up when multi-domain evidence covers subquestions", () => {
    const gap = detectResearchGaps(plan({ subquestions: ["pricing", "benchmarks"] }), [
      {
        url: "https://a.example",
        title: "pricing",
        domain: "a.example",
        text: "pricing details for the product",
        retrieval: "web_search",
      },
      {
        url: "https://b.example",
        title: "benchmarks",
        domain: "b.example",
        text: "benchmarks and latency numbers",
        retrieval: "web_search",
      },
      {
        url: "https://c.example",
        title: "more",
        domain: "c.example",
        text: "pricing and benchmarks overview",
        retrieval: "web_search",
      },
    ]);
    expect(gap.needsFollowUp).toBe(false);
  });
});
