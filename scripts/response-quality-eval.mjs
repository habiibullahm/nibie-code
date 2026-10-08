import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DIMENSIONS = ["accuracy", "completeness", "whyHow", "example", "continuity", "tradeoffs", "grounding", "brevity"];
export const MODES = ["Fast", "Balanced", "High"];
/** Minimum comparable pairs per mode before a PASS claim is allowed. */
export const MIN_FAIR_PAIRS_PER_MODE = 5;
/** Minimum total comparable pairs across modes. */
export const MIN_FAIR_PAIRS_TOTAL = 15;
const fixturePath = fileURLToPath(new URL("../tests/fixtures/response-quality-v2.json", import.meta.url));

export function loadCases() {
  const source = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (source.version !== 1 || !Array.isArray(source.cases) || source.cases.length < 20 || source.cases.length > 30) throw new Error("Invalid quality case set");
  const ids = new Set();
  for (const row of source.cases) {
    if (!row.id || ids.has(row.id) || !["id", "en"].includes(row.language) || !row.prompt?.trim() ||
      !Array.isArray(row.dimensions) || row.dimensions.length < 2 || row.dimensions.some((d) => !DIMENSIONS.includes(d))) throw new Error("Invalid quality fixture");
    ids.add(row.id);
  }
  return source.cases;
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
  for (const key of testcase.dimensions) {
    if (![0, 1, 2].includes(run.ratings?.[key])) throw new Error("Missing human rating " + key + " for " + run.caseId);
  }
  const points = testcase.dimensions.reduce((n, d) => n + run.ratings[d], 0);
  return { ...run, dimensions: testcase.dimensions, points, possible: 2 * testcase.dimensions.length, score: points / (2 * testcase.dimensions.length) };
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
  return { scored, ratio: points / possible, critical: scored.filter((r) => r.critical).length,
    brevityFailures: scored.filter((r) => r.dimensions.includes("brevity") && r.ratings.brevity < 2).length,
    coverage: Object.fromEntries(MODES.map((mode) => [mode, scored.filter((r) => r.mode === mode).length])) };
}

export function comparePhases(baseline, after, cases = loadCases()) {
  const before = scorePhase(baseline, cases);
  const next = scorePhase(after, cases);
  const original = new Map(before.scored.map((row) => [row.mode + "/" + row.caseId, row]));
  const pairs = [];
  for (const item of next.scored) {
    const prior = original.get(item.mode + "/" + item.caseId);
    if (!prior) continue;
    const comparable = prior.provider === item.provider && prior.model === item.model &&
      prior.reasoningEffort === item.reasoningEffort && prior.contextTruncated === item.contextTruncated;
    pairs.push({ id: item.caseId, mode: item.mode, baseline: prior.score, after: item.score, comparable,
      baselineBrevity: prior.ratings.brevity, afterBrevity: item.ratings.brevity });
  }
  const fair = pairs.filter((p) => p.comparable);
  const fairCoverage = Object.fromEntries(MODES.map((mode) => [mode, fair.filter((p) => p.mode === mode).length]));
  const coverageOk = fair.length >= MIN_FAIR_PAIRS_TOTAL &&
    MODES.every((mode) => fairCoverage[mode] >= MIN_FAIR_PAIRS_PER_MODE);
  const baselineRatio = fair.length ? fair.reduce((n, p) => n + p.baseline, 0) / fair.length : null;
  const afterRatio = fair.length ? fair.reduce((n, p) => n + p.after, 0) / fair.length : null;
  const regressedBrevity = fair.filter((p) => p.baselineBrevity !== undefined && p.afterBrevity < p.baselineBrevity).length;
  const passes = coverageOk && afterRatio >= 0.8 && next.critical === 0 && next.brevityFailures === 0 && regressedBrevity === 0;
  return {
    before, after: next, pairs, fairPairs: fair.length, fairCoverage, coverageOk,
    baselineRatio, afterRatio, regressedBrevity, passes,
  };
}

const percent = (v) => v === null ? "N/A" : (v * 100).toFixed(1) + "%";
export function formatReport(result) {
  const coverage = (phase) => MODES.map((m) => m + "=" + phase.coverage[m]).join(", ");
  const rows = result.pairs.map((p) => "| " + p.id + " | " + p.mode + " | " + percent(p.baseline) +
    " | " + percent(p.after) + " | " + (p.comparable ? "yes" : "no (config/context changed)") + " |").join("\n");
  return [
    "# Response Quality V2 — actual-output review",
    "",
    "Human-scored observed provider responses, NOT prompt assertions or model-generated grading. Scores use only case-relevant rubric dimensions (0 = absent/wrong, 1 = partial, 2 = good). Never score by word count.",
    "",
    "- Comparable pairs: " + result.fairPairs +
      " (min " + MIN_FAIR_PAIRS_TOTAL + " total; min " + MIN_FAIR_PAIRS_PER_MODE + " per mode: " +
      MODES.map((m) => m + "=" + (result.fairCoverage?.[m] ?? 0)).join(", ") +
      "; coverageOk=" + result.coverageOk + ")",
    "- Baseline (comparable pairs): " + percent(result.baselineRatio),
    "- After (comparable pairs): " + percent(result.afterRatio),
    "- Baseline coverage: " + coverage(result.before),
    "- After coverage: " + coverage(result.after),
    "- Critical issues after: " + result.after.critical,
    "- Brevity failures after: " + result.after.brevityFailures,
    "- Brevity regressions: " + result.regressedBrevity,
    "- Quality gate (>=80%, coverage floors, human_reviewed fidelity, zero critical/brevity regressions): " + (result.passes ? "PASS" : "FAIL"),
    "",
    "| Case | Mode | Before | After | Comparable |",
    "| --- | --- | ---: | ---: | --- |",
    rows || "| No matched cases | — | — | — | no |",
    "",
    "A PASS requires human_reviewed source fidelity on every run, matched model/provider/effort/truncation, " +
      "at least " + MIN_FAIR_PAIRS_PER_MODE + " comparable pairs per mode and " + MIN_FAIR_PAIRS_TOTAL +
      " total, >=80% after score, and zero critical or brevity regressions. Retain prompt version, context diagnostics, cost, and reviewer identity privately. Do not commit raw production conversations.",
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
