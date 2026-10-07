import { describe, expect, it } from "vitest";
import {
  fallbackResearchPlan,
  parseAndBoundResearchPlan,
  ResearchPlanError,
} from "@/lib/research/plan";
import {
  RESEARCH_MAX_INITIAL_QUERIES,
  RESEARCH_MAX_SUBQUESTIONS,
} from "@/lib/research/budgets";

describe("deep research plan bounds", () => {
  it("parses and clamps oversized planner output", () => {
    const raw = JSON.stringify({
      normalizedQuestion: "Compare A and B",
      subquestions: Array.from({ length: 12 }, (_, i) => `q${i} detail enough`),
      initialQueries: Array.from({ length: 20 }, (_, i) => `search query number ${i}`),
      timeSensitive: false,
      notes: "ok",
    });
    const plan = parseAndBoundResearchPlan(raw, "fallback");
    expect(plan.subquestions.length).toBeLessThanOrEqual(RESEARCH_MAX_SUBQUESTIONS);
    expect(plan.initialQueries.length).toBeLessThanOrEqual(RESEARCH_MAX_INITIAL_QUERIES);
    expect(plan.normalizedQuestion).toBe("Compare A and B");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAndBoundResearchPlan("not-json", "q")).toThrow(ResearchPlanError);
  });

  it("fallback marks time-sensitive cues", () => {
    expect(fallbackResearchPlan("What is the latest price of X today?").timeSensitive).toBe(true);
    expect(fallbackResearchPlan("Explain recursion briefly.").timeSensitive).toBe(false);
  });

  it("dedupes queries case-insensitively", () => {
    const plan = parseAndBoundResearchPlan(
      JSON.stringify({
        normalizedQuestion: "Node version",
        subquestions: ["current node"],
        initialQueries: ["Node.js release", "node.js Release", "nodejs LTS"],
        timeSensitive: true,
      }),
      "Node version",
    );
    expect(plan.initialQueries).toEqual(["Node.js release", "nodejs LTS"]);
  });
});
