import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  comparePhases,
  formatReport,
  loadCases,
  MIN_FAIR_PAIRS_PER_MODE,
  MIN_FAIR_PAIRS_TOTAL,
  MODES,
  scorePhase,
} from "../../scripts/response-quality-eval.mjs";

const cases = loadCases();

function runFor(caseId, mode, score, overrides = {}) {
  const dims = cases.find((c) => c.id === caseId).dimensions;
  const ratings = Object.fromEntries(dims.map((d) => [d, score]));
  return {
    caseId,
    mode,
    model: "synthetic-model",
    provider: "mock",
    reasoningEffort: "provider_default",
    finishReason: "stop",
    latencyMs: 100,
    outputTokens: 100,
    contextTruncated: false,
    response: "Synthetic placeholder text for scorer tests only. Not a real provider answer.",
    reviewer: "test-fixture",
    reviewNotes: "Only tests arithmetic and validation; never a quality baseline.",
    sourceFidelity: "human_reviewed",
    critical: false,
    ratings,
    ...overrides,
  };
}

/** Build enough synthetic pairs to clear coverage floors (5 per mode / 15 total). */
function coveredPhases(beforeScore, afterScore, overrides = {}) {
  const ids = cases.slice(0, MIN_FAIR_PAIRS_PER_MODE).map((c) => c.id);
  const before = { runs: [] };
  const after = { runs: [] };
  for (const mode of MODES) {
    for (const caseId of ids) {
      before.runs.push(runFor(caseId, mode, beforeScore, overrides));
      after.runs.push(runFor(caseId, mode, afterScore, overrides));
    }
  }
  return { before, after };
}

describe("Response Quality V2 evaluator — synthetic scorer tests, NOT model-quality evidence", () => {
  it("requires 20-30 unique bilingual cases", () => {
    assert.equal(cases.length, 30);
    assert.equal(new Set(cases.map((c) => c.id)).size, 30);
    assert.ok(cases.some((c) => c.language === "id"));
    assert.ok(cases.some((c) => c.language === "en"));
  });

  it("rejects a single-pair pass even when the after score is perfect", () => {
    const one = {
      runs: [runFor("database-index-en", "Balanced", 2)],
    };
    const result = comparePhases(
      { runs: [runFor("database-index-en", "Balanced", 1)] },
      one,
      cases,
    );
    assert.equal(result.fairPairs, 1);
    assert.equal(result.coverageOk, false);
    assert.equal(result.passes, false);
  });

  it("computes only actual-response human ratings and a comparable before/after delta with coverage floors", () => {
    const { before, after } = coveredPhases(1, 2);
    assert.ok(before.runs.length >= MIN_FAIR_PAIRS_TOTAL);
    const result = comparePhases(before, after, cases);
    assert.equal(result.fairPairs, MIN_FAIR_PAIRS_TOTAL);
    assert.equal(result.coverageOk, true);
    for (const mode of MODES) assert.equal(result.fairCoverage[mode], MIN_FAIR_PAIRS_PER_MODE);
    assert.equal(result.baselineRatio, 0.5);
    assert.equal(result.afterRatio, 1);
    assert.equal(result.passes, true);
    assert.match(formatReport(result), /After \(comparable pairs\): 100\.0%/);
    assert.match(formatReport(result), /coverageOk=true/);
  });

  it("fails closed when outputs, fidelity, or manual ratings are missing", () => {
    assert.throws(() => scorePhase({ runs: [] }, cases), /BLOCKED/);
    assert.throws(
      () => scorePhase({ runs: [runFor("database-index-en", "Balanced", 2, { response: "" })] }, cases),
      /Incomplete actual-model output/,
    );
    assert.throws(
      () => scorePhase({ runs: [runFor("database-index-en", "Balanced", 2, { ratings: {} })] }, cases),
      /Missing human rating/,
    );
    assert.throws(
      () => scorePhase({ runs: [runFor("database-index-en", "Balanced", 2, { sourceFidelity: "unverified" })] }, cases),
      /Incomplete actual-model output/,
    );
  });

  it("does not call changed model/reasoning configurations an improvement", () => {
    const { before, after } = coveredPhases(1, 2);
    after.runs = after.runs.map((run) => ({ ...run, reasoningEffort: "high" }));
    const result = comparePhases(before, after, cases);
    assert.equal(result.fairPairs, 0);
    assert.equal(result.coverageOk, false);
    assert.equal(result.passes, false);
  });

  it("blocks critical failures even at full rubric score with full coverage", () => {
    const { before, after } = coveredPhases(2, 2);
    after.runs[0].critical = true;
    assert.equal(comparePhases(before, after, cases).passes, false);
  });
});
