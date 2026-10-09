import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  CATEGORY_COVERAGE_FLOORS,
  comparePhases,
  coverageBucketForCategory,
  formatReport,
  LANGUAGE_COVERAGE_FLOORS,
  loadCases,
  MIN_FAIR_PAIRS_PER_MODE,
  MIN_FAIR_PAIRS_TOTAL,
  MODES,
  scorePhase,
} from "../../scripts/response-quality-eval.mjs";

const cases = loadCases();

/** Five fixtures that clear category + language floors when used across modes. */
const COVERAGE_CASE_IDS = [
  "debug-api-en", // debugging + en
  "architecture-caching-en", // architecture + en
  "followup-stack-en", // follow-up + en
  "no-fabrication-id", // grounding + id
  "database-index-en", // technical (explanation) + en
];

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
    responseDepth: "balanced",
    response: "Synthetic placeholder text for scorer tests only. Not a real provider answer.",
    reviewer: "test-fixture",
    reviewNotes: "Only tests arithmetic and validation; never a quality baseline.",
    sourceFidelity: "human_reviewed",
    critical: false,
    ratings,
    ...overrides,
  };
}

/** Build enough synthetic pairs to clear mode + category + language floors. */
function coveredPhases(beforeScore, afterScore, overrides = {}) {
  assert.equal(COVERAGE_CASE_IDS.length, MIN_FAIR_PAIRS_PER_MODE);
  const before = { runs: [] };
  const after = { runs: [] };
  for (const mode of MODES) {
    for (const caseId of COVERAGE_CASE_IDS) {
      before.runs.push(runFor(caseId, mode, beforeScore, overrides));
      after.runs.push(runFor(caseId, mode, afterScore, overrides));
    }
  }
  return { before, after };
}

describe("Response Quality V2 evaluator — synthetic scorer tests, NOT model-quality evidence", () => {
  it("requires 20-30 unique bilingual cases with required coverage categories present", () => {
    assert.equal(cases.length, 30);
    assert.equal(new Set(cases.map((c) => c.id)).size, 30);
    assert.ok(cases.some((c) => c.language === "id"));
    assert.ok(cases.some((c) => c.language === "en"));
    for (const bucket of Object.keys(CATEGORY_COVERAGE_FLOORS)) {
      assert.ok(
        cases.some((c) => coverageBucketForCategory(c.category) === bucket),
        "fixture missing coverage bucket " + bucket,
      );
    }
    for (const id of COVERAGE_CASE_IDS) {
      assert.ok(cases.some((c) => c.id === id), "missing coverage fixture " + id);
    }
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

  it("rejects identical baseline/after scores even with full coverage (no improvement)", () => {
    const { before, after } = coveredPhases(2, 2);
    const result = comparePhases(before, after, cases);
    assert.equal(result.fairPairs, MIN_FAIR_PAIRS_TOTAL);
    assert.equal(result.coverageOk, true);
    assert.equal(result.baselineRatio, 1);
    assert.equal(result.afterRatio, 1);
    assert.equal(result.improved, false);
    assert.equal(result.passes, false);
    assert.match(formatReport(result), /Positive improvement \(after > baseline\): no/);
  });

  it("computes human ratings with coverage floors, positive improvement, and category/language reporting", () => {
    const { before, after } = coveredPhases(1, 2);
    assert.ok(before.runs.length >= MIN_FAIR_PAIRS_TOTAL);
    const result = comparePhases(before, after, cases);
    assert.equal(result.fairPairs, MIN_FAIR_PAIRS_TOTAL);
    assert.equal(result.modeCoverageOk, true);
    assert.equal(result.categoryOk, true);
    assert.equal(result.languageOk, true);
    assert.equal(result.coverageOk, true);
    for (const mode of MODES) assert.equal(result.fairCoverage[mode], MIN_FAIR_PAIRS_PER_MODE);
    for (const [bucket, min] of Object.entries(CATEGORY_COVERAGE_FLOORS)) {
      assert.ok(result.categoryCoverage[bucket] >= min, bucket);
    }
    for (const [lang, min] of Object.entries(LANGUAGE_COVERAGE_FLOORS)) {
      assert.ok(result.languageCoverage[lang] >= min, lang);
    }
    assert.equal(result.baselineRatio, 0.5);
    assert.equal(result.afterRatio, 1);
    assert.equal(result.improved, true);
    assert.equal(result.nonRegressionOk, true);
    assert.equal(result.passes, true);
    assert.match(formatReport(result), /After \(comparable pairs\): 100\.0%/);
    assert.match(formatReport(result), /coverageOk=true/);
    assert.match(formatReport(result), /Category floors \(fair pairs\):/);
    assert.match(formatReport(result), /Language floors \(fair pairs\):/);
    assert.match(formatReport(result), /Positive improvement \(after > baseline\): yes/);
  });

  it("fails when fair pairs omit a required category or language floor", () => {
    const ids = ["debug-api-en", "architecture-caching-en", "followup-stack-en", "database-index-en", "rest-explanation-en"];
    // All English, no grounding — should fail language id + grounding floors.
    const before = { runs: [] };
    const after = { runs: [] };
    for (const mode of MODES) {
      for (const caseId of ids) {
        before.runs.push(runFor(caseId, mode, 1));
        after.runs.push(runFor(caseId, mode, 2));
      }
    }
    const result = comparePhases(before, after, cases);
    assert.equal(result.modeCoverageOk, true);
    assert.equal(result.languageOk, false);
    assert.equal(result.categoryOk, false);
    assert.equal(result.coverageOk, false);
    assert.equal(result.passes, false);
    assert.equal(result.categoryCoverage.grounding, 0);
    assert.equal(result.languageCoverage.id, 0);
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

  it("rejects mismatched finishReason and excludes incomplete length/error finishes from fair pairs", () => {
    const { before, after } = coveredPhases(1, 2);
    after.runs = after.runs.map((run, index) =>
      index === 0 ? { ...run, finishReason: "length" } : run,
    );
    const result = comparePhases(before, after, cases);
    assert.ok(result.incompletePairs >= 1);
    assert.equal(result.fairPairs, MIN_FAIR_PAIRS_TOTAL - 1);
    assert.equal(result.passes, false);

    const bothLength = coveredPhases(1, 2, { finishReason: "length" });
    const incomplete = comparePhases(bothLength.before, bothLength.after, cases);
    assert.equal(incomplete.fairPairs, 0);
    assert.equal(incomplete.coverageOk, false);
    assert.equal(incomplete.passes, false);
  });

  it("rejects mismatched responseDepth or context fingerprints", () => {
    const depth = coveredPhases(1, 2);
    depth.after.runs = depth.after.runs.map((run) => ({ ...run, responseDepth: "detailed" }));
    assert.equal(comparePhases(depth.before, depth.after, cases).fairPairs, 0);

    const history = coveredPhases(1, 2);
    history.before.runs = history.before.runs.map((run) => ({ ...run, historyFingerprint: "hist-a" }));
    history.after.runs = history.after.runs.map((run) => ({ ...run, historyFingerprint: "hist-b" }));
    assert.equal(comparePhases(history.before, history.after, cases).fairPairs, 0);

    const matched = coveredPhases(1, 2, {
      historyFingerprint: "hist-a",
      roomFingerprint: "room-a",
      filesFingerprint: "files-a",
      toolsFingerprint: "tools-none",
    });
    const ok = comparePhases(matched.before, matched.after, cases);
    assert.equal(ok.fairPairs, MIN_FAIR_PAIRS_TOTAL);
    assert.equal(ok.passes, true);
  });

  it("blocks accuracy/completeness regressions even when the average score rises", () => {
    const { before, after } = coveredPhases(1, 2);
    // Drop accuracy on one accuracy-bearing case while others improve.
    const target = after.runs.find((run) => run.caseId === "database-index-en" && run.mode === "Balanced");
    assert.ok(target);
    target.ratings = { ...target.ratings, accuracy: 0, completeness: 2, whyHow: 2, example: 2, tradeoffs: 2 };
    const result = comparePhases(before, after, cases);
    assert.equal(result.factualCompletenessRegressions >= 1, true);
    assert.equal(result.nonRegressionOk, false);
    assert.equal(result.passes, false);
  });

  it("blocks critical failures even at full rubric score with full coverage", () => {
    const { before, after } = coveredPhases(1, 2);
    after.runs[0].critical = true;
    assert.equal(comparePhases(before, after, cases).passes, false);
  });
});
