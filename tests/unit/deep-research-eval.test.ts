import { describe, expect, it } from "vitest";
import { fallbackResearchPlan, parseAndBoundResearchPlan } from "@/lib/research/plan";
import { detectResearchGaps } from "@/lib/research/gap";
import { detectContradictions, extractEvidenceChunk } from "@/lib/research/evidence";
import { DEEP_RESEARCH_EVAL_CASES, MOCK_RESEARCH_PAGES } from "../fixtures/deep-research";
import { researchSynthesisInstruction } from "@/lib/research/synthesize";
import { attachWebCitationHandles } from "@/lib/citations/attach";
import { MAX_RESEARCH_PREPARED_SOURCES } from "@/lib/citations/prepare";
import { evidenceToWebContext } from "@/lib/research/evidence";
import { isLikelyPrimarySource, selectResearchUrlsToFetch } from "@/lib/research/select";
import type { WebSearchResult } from "@/lib/web/types";

describe("deep research eval set", () => {
  it("covers required acceptance scenarios", () => {
    const ids = DEEP_RESEARCH_EVAL_CASES.map((c) => c.id);
    for (const required of [
      "current-facts",
      "technical-compare",
      "official-docs",
      "conflicting-sources",
      "timeless-concept",
      "weak-evidence",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it.each(DEEP_RESEARCH_EVAL_CASES)("$id — time sensitivity and bounded plan", (testCase) => {
    const plan = fallbackResearchPlan(testCase.question);
    expect(plan.initialQueries.length).toBeGreaterThan(0);
    expect(plan.initialQueries.length).toBeLessThanOrEqual(8);
    if (testCase.expectTimeSensitive) {
      expect(plan.timeSensitive).toBe(true);
    } else if (testCase.id === "timeless-concept") {
      expect(plan.timeSensitive).toBe(false);
    }
  });

  it("conflicting sources produce contradiction cues and citation handles", () => {
    const chunks = [
      extractEvidenceChunk({
        url: MOCK_RESEARCH_PAGES.pricingA.url,
        title: MOCK_RESEARCH_PAGES.pricingA.title,
        domain: MOCK_RESEARCH_PAGES.pricingA.domain,
        retrieval: "web_search",
        text: "Pro plan costs $20 per month. Benchmark score 82.",
      }),
      extractEvidenceChunk({
        url: MOCK_RESEARCH_PAGES.pricingB.url,
        title: MOCK_RESEARCH_PAGES.pricingB.title,
        domain: MOCK_RESEARCH_PAGES.pricingB.domain,
        retrieval: "web_search",
        text: "Pro plan listed at $29 per month. Independent benchmark score 71.",
      }),
    ];
    const contradictions = detectContradictions(chunks);
    expect(contradictions.length).toBeGreaterThan(0);
    const attached = attachWebCitationHandles(evidenceToWebContext(chunks), new Date(), MAX_RESEARCH_PREPARED_SOURCES);
    expect(attached.sources.length).toBe(2);
    expect(attached.web.every((w) => w.citationHandle?.startsWith("web:"))).toBe(true);
    const instruction = researchSynthesisInstruction({
      plan: parseAndBoundResearchPlan(
        JSON.stringify({
          normalizedQuestion: "Model X pricing",
          subquestions: ["pricing", "benchmarks"],
          initialQueries: ["model x pricing"],
          timeSensitive: true,
        }),
        "Model X",
      ),
      sources: attached.sources,
      contradictions,
      incompleteNotice: null,
    });
    expect(instruction).toMatch(/disagree|disagreement/i);
    expect(instruction).toMatch(/SOURCE:web:1/);
  });

  it("weak evidence stays incomplete-aware", () => {
    const plan = fallbackResearchPlan(DEEP_RESEARCH_EVAL_CASES.find((c) => c.id === "weak-evidence")!.question);
    const gap = detectResearchGaps(plan, []);
    expect(gap.needsFollowUp).toBe(true);
    const instruction = researchSynthesisInstruction({
      plan,
      sources: [],
      contradictions: [],
      incompleteNotice: "Deep Research could not collect usable sources.",
    });
    expect(instruction).toMatch(/incomplete|could not|fabricate/i);
  });

  it("timeless concept synthesis must not over-weight freshness", () => {
    const plan = fallbackResearchPlan("Explain what a Bloom filter is");
    expect(plan.timeSensitive).toBe(false);
    const instruction = researchSynthesisInstruction({
      plan,
      sources: [],
      contradictions: [],
      incompleteNotice: null,
    });
    expect(instruction).toMatch(/not primarily time-sensitive|do not over-weight recency/i);
  });

  it("current-facts selection prefers fresher publishedAt when timeSensitive", () => {
    const plan = fallbackResearchPlan(DEEP_RESEARCH_EVAL_CASES.find((c) => c.id === "current-facts")!.question);
    expect(plan.timeSensitive).toBe(true);
    const candidates: WebSearchResult[] = [
      {
        title: "Old",
        url: "https://archive.example/node",
        snippet: "old",
        rank: 1,
        domain: "archive.example",
        publishedAt: "2019-01-01",
      },
      {
        title: "Fresh",
        url: "https://nodejs.org/en/about/previous-releases",
        snippet: "current",
        rank: 2,
        domain: "nodejs.org",
        publishedAt: "2026-04-01",
      },
    ];
    const selected = selectResearchUrlsToFetch(candidates, 1, { timeSensitive: true });
    expect(selected[0]!.domain).toBe("nodejs.org");
  });

  it("official-docs selection prefers primary/docs domains", () => {
    const question = DEEP_RESEARCH_EVAL_CASES.find((c) => c.id === "official-docs")!.question;
    expect(question).toMatch(/official/i);
    expect(isLikelyPrimarySource(MOCK_RESEARCH_PAGES.postgresDocs.url, MOCK_RESEARCH_PAGES.postgresDocs.domain)).toBe(true);
    const candidates: WebSearchResult[] = [
      {
        title: "Random blog",
        url: "https://medium.com/some-post",
        snippet: "opinion",
        rank: 1,
        domain: "medium.com",
      },
      {
        title: MOCK_RESEARCH_PAGES.postgresDocs.title,
        url: MOCK_RESEARCH_PAGES.postgresDocs.url,
        snippet: "jsonb",
        rank: 2,
        domain: MOCK_RESEARCH_PAGES.postgresDocs.domain,
      },
    ];
    const selected = selectResearchUrlsToFetch(candidates, 1, { preferPrimary: true });
    expect(selected[0]!.domain).toBe(MOCK_RESEARCH_PAGES.postgresDocs.domain);
  });
});
