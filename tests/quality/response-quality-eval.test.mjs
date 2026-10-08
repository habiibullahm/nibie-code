import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { comparePhases, formatReport, loadCases, scorePhase } from "../../scripts/response-quality-eval.mjs";

const cases = loadCases();
const caseId = "database-index-en";
function synthetic(score) {
  return { runs: [{
    caseId, mode: "Balanced", model: "synthetic-model", provider: "mock", reasoningEffort: "provider_default",
    finishReason: "stop", latencyMs: 100, outputTokens: 100, contextTruncated: false,
    response: "Synthetic placeholder text for scorer tests only. Not a real provider answer.",
    reviewer: "test-fixture", reviewNotes: "Only tests arithmetic and validation; never a quality baseline.",
    critical: false, ratings: { accuracy: score, completeness: score, whyHow: score, example: score, tradeoffs: score }
  }] };
}
describe("Response Quality V2 evaluator — synthetic scorer tests, NOT model-quality evidence", () => {
  it("requires 20-30 unique bilingual cases", () => {
    assert.equal(cases.length, 30);
    assert.equal(new Set(cases.map((c) => c.id)).size, 30);
    assert.ok(cases.some((c) => c.language === "id"));
    assert.ok(cases.some((c) => c.language === "en"));
  });
  it("computes only actual-response human ratings and a comparable before/after delta", () => {
    const result = comparePhases(synthetic(1), synthetic(2), cases);
    assert.equal(result.fairPairs, 1);
    assert.equal(result.baselineRatio, 0.5);
    assert.equal(result.afterRatio, 1);
    assert.equal(result.passes, true);
    assert.match(formatReport(result), /After \(comparable pairs\): 100\.0%/);
  });
  it("fails closed when outputs or manual ratings are missing", () => {
    assert.throws(() => scorePhase({ runs: [] }, cases), /BLOCKED/);
    assert.throws(() => scorePhase({ runs: [{ ...synthetic(2).runs[0], response: "" }] }, cases), /Incomplete actual-model output/);
    assert.throws(() => scorePhase({ runs: [{ ...synthetic(2).runs[0], ratings: {} }] }, cases), /Missing human rating/);
  });
  it("does not call changed model/reasoning configurations an improvement", () => {
    const next = synthetic(2);
    next.runs[0].reasoningEffort = "high";
    const result = comparePhases(synthetic(1), next, cases);
    assert.equal(result.fairPairs, 0);
    assert.equal(result.passes, false);
  });
  it("blocks critical failures even at full rubric score", () => {
    const next = synthetic(2);
    next.runs[0].critical = true;
    assert.equal(comparePhases(synthetic(2), next, cases).passes, false);
  });
});
