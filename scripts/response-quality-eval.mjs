import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DIMENSIONS = ["accuracy", "completeness", "whyHow", "example", "continuity", "tradeoffs", "grounding", "brevity"];
export const MODES = ["Fast", "Balanced", "High"];
/** Minimum comparable pairs per mode before a PASS claim is allowed. */
export const MIN_FAIR_PAIRS_PER_MODE = 5;
/** Minimum total comparable pairs across modes. */
export const MIN_FAIR_PAIRS_TOTAL = 15;
/** Finish reasons that count as a complete, fair answer for quality comparison. */
export const COMPLETE_FINISH_REASONS = new Set(["stop"]);
/** Depth settings that may appear on a run fingerprint. */
export const RESPONSE_DEPTHS = new Set(["concise", "balanced", "detailed"]);
/**
 * Category coverage floors for fair pairs (fixture `category` → coverage bucket).
 * "technical" aggregates explanation/coding/how-to/comparison depth work.
 */
export const CATEGORY_COVERAGE_FLOORS = {
  technical: 1,
  debugging: 1,
  architecture: 1,
  "follow-up": 1,
  grounding: 1,
};
/** Language coverage floors for fair pairs. */
export const LANGUAGE_COVERAGE_FLOORS = { en: 1, id: 1 };

const fixturePath = fileURLToPath(new URL("../tests/fixtures/response-quality-v2.json", import.meta.url));

const TECHNICAL_CATEGORIES = new Set(["explanation", "coding", "how-to", "comparison"]);

export function coverageBucketForCategory(category) {
  if (!category) return null;
  if (CATEGORY_COVERAGE_FLOORS[category] !== undefined) return category;
  if (TECHNICAL_CATEGORIES.has(category)) return "technical";
  return null;
}

export function loadCases() {
  const source = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (source.version !== 1 || !Array.isArray(source.cases) || source.cases.length < 20 || source.cases.length > 30) throw new Error("Invalid quality case set");
  const ids = new Set();
  for (const row of source.cases) {
    if (!row.id || ids.has(row.id) || !["id", "en"].includes(row.language) || !row.prompt?.trim() ||
      !row.category?.trim() ||
      !Array.isArray(row.dimensions) || row.dimensions.length < 2 || row.dimensions.some((d) => !DIMENSIONS.includes(d))) throw new Error("Invalid quality fixture");
    ids.add(row.id);
  }
  return source.cases;
}

function optionalFingerprint(value, label) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("Invalid " + label + " fingerprint (must be a string)");
  return value.trim();
}

function normalizeDepth(value) {
  if (value === undefined || value === null || value === "") return "balanced";
  if (typeof value !== "string" || !RESPONSE_DEPTHS.has(value)) throw new Error("Invalid responseDepth (concise|balanced|detailed)");
  return value;
}

function validateRun(run, cases) {
  const testcase = cases.find((item) => item.id === run.caseId);
  if (!testcase) throw new Error("Unknown case: " + run.caseId);
  if (!MODES.includes(run.mode) || !run.model?.trim() || !run.provider?.trim() || !run.response?.trim() ||
    !["none", "low", "medium", "high", "provider_default"].includes(run.reasoningEffort) ||
    !["stop", "length", "content_filter", "unknown", "error"].includes(run.finishReason) ||
    !Number.isFinite(run.latencyMs) || run.latencyMs < 0 ||
    !Number.isInteger(run.outputTokens) || run.outputTokens < 0 ||
    typeof run.contextTruncated !== "boolean" || !run.reviewer?.trim() || !run.reviewNotes?.trim() ||
    run.sourceFidelity !== "human_reviewed" ||
    typeof run.critical !== "boolean") throw new Error("Incomplete actual-model output metadata for " + run.caseId);
  const responseDepth = normalizeDepth(run.responseDepth);
  const historyFingerprint = optionalFingerprint(run.historyFingerprint, "historyFingerprint");
  const roomFingerprint = optionalFingerprint(run.roomFingerprint, "roomFingerprint");
  const filesFingerprint = optionalFingerprint(run.filesFingerprint, "filesFingerprint");
  const toolsFingerprint = optionalFingerprint(run.toolsFingerprint, "toolsFingerprint");
  for (const key of testcase.dimensions) {
    if (![0, 1, 2].includes(run.ratings?.[key])) throw new Error("Missing human rating " + key + " for " + run.caseId);
  }
  const points = testcase.dimensions.reduce((n, d) => n + run.ratings[d], 0);
  const incomplete = !COMPLETE_FINISH_REASONS.has(run.finishReason);
  return {
    ...run,
    responseDepth,
    historyFingerprint,
    roomFingerprint,
    filesFingerprint,
    toolsFingerprint,
    fixtureId: testcase.id,
    language: testcase.language,
    category: testcase.category,
    coverageBucket: coverageBucketForCategory(testcase.category),
    dimensions: testcase.dimensions,
    points,
    possible: 2 * testcase.dimensions.length,
    score: points / (2 * testcase.dimensions.length),
    incomplete,
  };
}

/** Stable context/config fingerprint used for fair before/after pairing. */
export function runFingerprint(run) {
  return [
    run.provider,
    run.model,
    run.reasoningEffort,
    String(run.contextTruncated),
    run.finishReason,
    run.responseDepth,
    run.fixtureId,
    run.historyFingerprint,
    run.roomFingerprint,
    run.filesFingerprint,
    run.toolsFingerprint,
  ].join("|");
}

export function scorePhase(data, cases = loadCases()) {
  if (!data || !Array.isArray(data.runs) || data.runs.length === 0) throw new Error("No actual provider-output runs supplied; BLOCKED");
  const keys = new Set();
  const scored = data.runs.map((run) => {
    const id = run.mode + "/" + run.caseId;
    if (keys.has(id)) throw new Error("Duplicate case/mode: " + id);
    keys.add(id);
    return validateRun(run, cases);
  });
  const points = scored.reduce((n, run) => n + run.points, 0);
  const possible = scored.reduce((n, run) => n + run.possible, 0);
  return {
    scored,
    ratio: points / possible,
    critical: scored.filter((r) => r.critical).length,
    brevityFailures: scored.filter((r) => r.dimensions.includes("brevity") && r.ratings.brevity < 2).length,
    incomplete: scored.filter((r) => r.incomplete).length,
    coverage: Object.fromEntries(MODES.map((mode) => [mode, scored.filter((r) => r.mode === mode).length])),
  };
}

function ratingOrNull(run, dimension) {
  if (!run.dimensions.includes(dimension)) return null;
  return run.ratings[dimension];
}

function factualCompletenessRegression(prior, next) {
  for (const dimension of ["accuracy", "completeness"]) {
    const before = ratingOrNull(prior, dimension);
    const after = ratingOrNull(next, dimension);
    if (before === null || after === null) continue;
    if (after < before) return true;
  }
  return false;
}

export function summarizeFairCoverage(fair, cases = loadCases()) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const categoryCoverage = Object.fromEntries(Object.keys(CATEGORY_COVERAGE_FLOORS).map((key) => [key, 0]));
  const languageCoverage = Object.fromEntries(Object.keys(LANGUAGE_COVERAGE_FLOORS).map((key) => [key, 0]));
  for (const pair of fair) {
    const testcase = byId.get(pair.id);
    if (!testcase) continue;
    const bucket = coverageBucketForCategory(testcase.category);
    if (bucket && categoryCoverage[bucket] !== undefined) categoryCoverage[bucket] += 1;
    if (languageCoverage[testcase.language] !== undefined) languageCoverage[testcase.language] += 1;
  }
  const categoryOk = Object.entries(CATEGORY_COVERAGE_FLOORS).every(([key, min]) => categoryCoverage[key] >= min);
  const languageOk = Object.entries(LANGUAGE_COVERAGE_FLOORS).every(([key, min]) => languageCoverage[key] >= min);
  return { categoryCoverage, languageCoverage, categoryOk, languageOk, coverageDetailOk: categoryOk && languageOk };
}

export function comparePhases(baseline, after, cases = loadCases()) {
  const before = scorePhase(baseline, cases);
  const next = scorePhase(after, cases);
  const original = new Map(before.scored.map((row) => [row.mode + "/" + row.caseId, row]));
  const pairs = [];
  const incompletePairs = [];
  for (const item of next.scored) {
    const prior = original.get(item.mode + "/" + item.caseId);
    if (!prior) continue;
    const finishMatched = prior.finishReason === item.finishReason;
    const bothComplete = COMPLETE_FINISH_REASONS.has(prior.finishReason) && COMPLETE_FINISH_REASONS.has(item.finishReason);
    const fingerprintMatched = runFingerprint(prior) === runFingerprint(item);
    const comparable = fingerprintMatched && finishMatched && bothComplete;
    const row = {
      id: item.caseId,
      mode: item.mode,
      baseline: prior.score,
      after: item.score,
      comparable,
      finishReasonBaseline: prior.finishReason,
      finishReasonAfter: item.finishReason,
      fingerprintBaseline: runFingerprint(prior),
      fingerprintAfter: runFingerprint(item),
      incomplete: prior.incomplete || item.incomplete || !bothComplete,
      factualCompletenessRegressed: factualCompletenessRegression(prior, item),
      baselineBrevity: prior.ratings.brevity,
      afterBrevity: item.ratings.brevity,
      language: item.language,
      category: item.category,
      coverageBucket: item.coverageBucket,
      responseDepth: item.responseDepth,
    };
    pairs.push(row);
    if (row.incomplete || !finishMatched) incompletePairs.push(row);
  }
  const fair = pairs.filter((p) => p.comparable);
  const fairCoverage = Object.fromEntries(MODES.map((mode) => [mode, fair.filter((p) => p.mode === mode).length]));
  const modeCoverageOk = fair.length >= MIN_FAIR_PAIRS_TOTAL &&
    MODES.every((mode) => fairCoverage[mode] >= MIN_FAIR_PAIRS_PER_MODE);
  const detailCoverage = summarizeFairCoverage(fair, cases);
  const coverageOk = modeCoverageOk && detailCoverage.coverageDetailOk;
  const baselineRatio = fair.length ? fair.reduce((n, p) => n + p.baseline, 0) / fair.length : null;
  const afterRatio = fair.length ? fair.reduce((n, p) => n + p.after, 0) / fair.length : null;
  const improved = baselineRatio !== null && afterRatio !== null && afterRatio > baselineRatio;
  const regressedBrevity = fair.filter((p) => p.baselineBrevity !== undefined && p.afterBrevity < p.baselineBrevity).length;
  const factualCompletenessRegressions = fair.filter((p) => p.factualCompletenessRegressed).length;
  const nonRegressionOk = factualCompletenessRegressions === 0;
  const passes = coverageOk && improved && nonRegressionOk && afterRatio >= 0.8 &&
    next.critical === 0 && next.brevityFailures === 0 && regressedBrevity === 0;
  return {
    before,
    after: next,
    pairs,
    fairPairs: fair.length,
    fairCoverage,
    categoryCoverage: detailCoverage.categoryCoverage,
    languageCoverage: detailCoverage.languageCoverage,
    categoryOk: detailCoverage.categoryOk,
    languageOk: detailCoverage.languageOk,
    modeCoverageOk,
    coverageOk,
    incompletePairs: incompletePairs.length,
    baselineRatio,
    afterRatio,
    improved,
    nonRegressionOk,
    factualCompletenessRegressions,
    regressedBrevity,
    passes,
  };
}

const percent = (v) => v === null ? "N/A" : (v * 100).toFixed(1) + "%";
export function formatReport(result) {
  const coverage = (phase) => MODES.map((m) => m + "=" + phase.coverage[m]).join(", ");
  const floors = (obj) => Object.entries(obj).map(([k, v]) => k + "=" + v).join(", ");
  const rows = result.pairs.map((p) => "| " + p.id + " | " + p.mode + " | " + percent(p.baseline) +
    " | " + percent(p.after) + " | " + (p.comparable ? "yes" : p.incomplete ? "no (incomplete/error finish)" : "no (config/context/fingerprint)") + " |").join("\n");
  return [
    "# Response Quality V2 — actual-output review",
    "",
    "Human-scored observed provider responses, NOT prompt assertions or model-generated grading. Scores use only case-relevant rubric dimensions (0 = absent/wrong, 1 = partial, 2 = good). Never score by word count.",
    "",
    "- Comparable pairs: " + result.fairPairs +
      " (min " + MIN_FAIR_PAIRS_TOTAL + " total; min " + MIN_FAIR_PAIRS_PER_MODE + " per mode: " +
      MODES.map((m) => m + "=" + (result.fairCoverage?.[m] ?? 0)).join(", ") +
      "; modeCoverageOk=" + result.modeCoverageOk + "; coverageOk=" + result.coverageOk + ")",
    "- Category floors (fair pairs): " + floors(result.categoryCoverage || {}) + " (ok=" + result.categoryOk + ")",
    "- Language floors (fair pairs): " + floors(result.languageCoverage || {}) + " (ok=" + result.languageOk + ")",
    "- Incomplete/error or finish-mismatched pairs (excluded from fair): " + (result.incompletePairs ?? 0),
    "- Baseline (comparable pairs): " + percent(result.baselineRatio),
    "- After (comparable pairs): " + percent(result.afterRatio),
    "- Positive improvement (after > baseline): " + (result.improved ? "yes" : "no"),
    "- Factual/completeness non-regression: " + (result.nonRegressionOk ? "yes" : "no") +
      " (regressions=" + (result.factualCompletenessRegressions ?? 0) + ")",
    "- Baseline coverage: " + coverage(result.before),
    "- After coverage: " + coverage(result.after),
    "- Critical issues after: " + result.after.critical,
    "- Brevity failures after: " + result.after.brevityFailures,
    "- Brevity regressions: " + result.regressedBrevity,
    "- Quality gate (>=80% after, after>baseline, category/language floors, human_reviewed, fingerprint match, complete finish only, zero critical/brevity/factual regressions): " + (result.passes ? "PASS" : "FAIL"),
    "",
    "| Case | Mode | Before | After | Comparable |",
    "| --- | --- | ---: | ---: | --- |",
    rows || "| No matched cases | — | — | — | no |",
    "",
    "A PASS requires human_reviewed source fidelity on every run, matched model/provider/effort/truncation/finishReason/responseDepth/fixture/context fingerprints, " +
      "complete finishes only (stop), at least " + MIN_FAIR_PAIRS_PER_MODE + " comparable pairs per mode and " + MIN_FAIR_PAIRS_TOTAL +
      " total, category floors (" + Object.keys(CATEGORY_COVERAGE_FLOORS).join(", ") + "), language floors (en, id), " +
      "strict positive improvement vs baseline (same scores are FAIL), hard non-regression on accuracy/completeness, >=80% after score, and zero critical or brevity regressions. " +
      "Retain prompt version, context diagnostics, cost, and reviewer identity privately. Do not commit raw production conversations.",
    ""
  ].join("\n");
}

function main(args) {
  const get = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const beforePath = get("--baseline"), afterPath = get("--after"), outPath = get("--out");
  if (!beforePath || !afterPath) { console.error("BLOCKED: supply actual model outputs --baseline <file.json> --after <file.json>; no API calls are made."); process.exitCode = 2; return; }
  try {
    const result = comparePhases(JSON.parse(readFileSync(beforePath, "utf8")), JSON.parse(readFileSync(afterPath, "utf8")));
    const report = formatReport(result);
    if (outPath) writeFileSync(outPath, report);
    else process.stdout.write(report);
    if (!result.passes) process.exitCode = 1;
  } catch (error) { console.error("BLOCKED: " + error.message); process.exitCode = 2; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
