import { createHash } from "node:crypto";
import { mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases, fixtureFingerprint, MODES, DIMENSIONS, CATEGORY_COVERAGE_FLOORS,
  LANGUAGE_COVERAGE_FLOORS, coverageBucketForCategory } from "./response-quality-eval.mjs";

// #80 evaluates the actual #77 application change. #120 changes its evaluator.
export const FOUNDATION_BASELINE_SHA = "fa19af9b07253ff45122c4910b8988dfd175643b";
export const FOUNDATION_CANDIDATE_SHA = "08d5506d4613a3394b58ddea6996d101f29649cb";
export const CAPTURE_CASE_IDS = [
  "database-index-en", "debug-stream-id", "architecture-caching-en",
  "followup-stack-en", "file-noanswer-en", "brevity-sentence-id", "detailed-setting-en",
];

export function capturePlan(cases = loadCases()) {
  const selected = CAPTURE_CASE_IDS.map(id => {
    const testcase = cases.find(item => item.id === id);
    if (!testcase) throw new Error("Capture fixture missing: " + id);
    return { ...testcase, fixtureFingerprint: fixtureFingerprint(testcase),
      requestedResponseDepth: id === "brevity-sentence-id" ? "concise" : id === "detailed-setting-en" ? "detailed" : "balanced" };
  });
  for (const bucket of Object.keys(CATEGORY_COVERAGE_FLOORS)) {
    if (!selected.some(item => coverageBucketForCategory(item.category) === bucket)) throw new Error("Capture plan missing " + bucket);
  }
  for (const language of Object.keys(LANGUAGE_COVERAGE_FLOORS)) {
    if (!selected.some(item => item.language === language)) throw new Error("Capture plan missing language " + language);
  }
  return { status: "UNRUN", cases: selected, modes: MODES,
    comparablePairsPlanned: selected.length * MODES.length,
    baselineAndCandidateCallsPlanned: selected.length * MODES.length * 2,
    extraCallsAuthorized: 0,
    note: "Planning only; probes, retries, setup turns and maintenance need separate accounting within an approved enforced cap." };
}

function blankPhase(phase, appCommitSha, plan) {
  return { status: "UNRUN", phase, appCommitSha, verifiedDeploymentSha: null, immutablePreviewUrl: null,
    runs: plan.modes.flatMap(mode => plan.cases.map(testcase => ({
      caseId: testcase.id, mode, fixtureFingerprint: testcase.fixtureFingerprint,
      requestedResponseDepth: testcase.requestedResponseDepth,
      appCommitSha, deploymentSha: null, capturedAt: null, requestId: null,
      model: null, provider: null, reasoningEffort: null, finishReason: null,
      latencyMs: null, inputTokens: null, outputTokens: null, costUsd: null,
      contextTruncated: null, responseDepth: null,
      historyFingerprint: null, roomFingerprint: null, filesFingerprint: null, toolsFingerprint: null,
      response: null, reviewer: null, reviewNotes: null, sourceFidelity: "unreviewed", critical: null,
      ratings: Object.fromEntries(testcase.dimensions.map(dimension => [dimension, null])),
    }))),
  };
}

export function prepareCapturePackage(directory, { baselineSha = FOUNDATION_BASELINE_SHA,
  candidateSha = FOUNDATION_CANDIDATE_SHA } = {}) {
  if (![baselineSha, candidateSha].every(sha => /^[a-f0-9]{40}$/.test(sha)) || baselineSha === candidateSha) {
    throw new Error("Distinct full baseline/candidate commit SHAs are required.");
  }
  const target = resolve(directory);
  const plan = capturePlan();
  // Refuse all existing destinations; never overwrite actual captures or reviewer work.
  mkdirSync(target, { mode: 0o700 });
  chmodSync(target, 0o700);
  const write = (name, value) => writeFileSync(resolve(target, name), value, { flag: "wx", mode: 0o600 });
  const json = (name, value) => write(name, JSON.stringify(value, null, 2) + "\n");
  json("capture-plan.json", plan);
  json("baseline.template.json", blankPhase("baseline", baselineSha, plan));
  json("candidate.template.json", blankPhase("candidate", candidateSha, plan));
  json("manifest.template.json", {
    status: "UNRUN", issue: 80, foundationPR: 77, toolingPR: 120,
    preparedAt: new Date().toISOString(),
    evaluatorSourceSha256: createHash("sha256").update(readFileSync(new URL("./response-quality-eval.mjs", import.meta.url))).digest("hex"),
    baseline: { sourceCommitSha: baselineSha, verifiedDeploymentSha: null, immutablePreviewUrl: null },
    candidate: { sourceCommitSha: candidateSha, verifiedDeploymentSha: null, immutablePreviewUrl: null },
    qaIsolation: { verified: false, projectAlias: null, disposableAccountAlias: null },
    budget: { currency: "USD", approvedMaxUsd: null, approvedBy: null, approvalReference: null,
      hardCapMechanism: null, enforcementVerified: false, actualTotalUsd: null,
      includesProbesRetriesSetupAndMaintenance: false },
    routes: MODES.map(mode => ({ mode, effectiveModel: null, effectiveProvider: null,
      capabilityEvidence: null, priceSource: null, priceVerifiedAt: null, billingSemantics: null })),
    independentHumanReviewer: null, humanReviewComplete: false,
    baselineAndCandidateCallsPlanned: plan.baselineAndCandidateCallsPlanned,
    extraCallsAuthorized: 0, releaseDecision: "BLOCKED",
  });
  const header = ["phase", "caseId", "mode", "requestId", "reviewer", "sourceFidelity", "critical", ...DIMENSIONS, "reviewNotes"];
  const rows = [header.join(",")];
  for (const phase of ["baseline", "candidate"]) {
    for (const mode of plan.modes) for (const testcase of plan.cases) {
      rows.push([phase, testcase.id, mode, ...Array(header.length - 3).fill("")].join(","));
    }
  }
  write("human-review.csv", rows.join("\n") + "\n");
  write("README.md", `# Issue #80 — new capture/review package

Status: **UNRUN / BLOCKED**. These are empty templates, not model responses or human ratings.
The plan has ${plan.comparablePairsPlanned} matched pairs (${plan.baselineAndCandidateCallsPlanned} successful model requests), before separately capped probes, history setup, retries and maintenance.
No provider request is made by the generator or scorer.

Before capture: verify isolated QA access, exact deployment SHAs, effective routes/capabilities/prices and an approved enforced aggregate USD cap. Keep proof in manifest.template.json. Do not use the shared production database or deploy from this package.

Original #77 baseline: ${baselineSha}; candidate: ${candidateSha}. These are source commits, not verified live deployments. Any substitute release candidate needs a recorded scope/confounder review.

Use capture-plan.json's identical prompts/history/file evidence in both phases. Set each requested depth, then record the actual effective depth. Record SHA-256 digests of actual supplied context; use none only for confirmed absence. Nulls stay BLOCKED; never copy fixture-input hashes as if they prove effective context.

Copy the phase templates to private baseline.json and candidate.json. Replace nulls only with observed redacted model responses, metadata, accounting and an independent human's source checks/ratings. Preserve failed/incomplete captures. Review scores are 0 (absent/wrong), 1 (partial), 2 (accurate/useful); score only the case's dimensions. No hidden reasoning, credentials or production transcripts.

After actual captures and human review, run from the evaluator checkout:

    npm run eval:response-quality -- --baseline <private-baseline.json> --after <private-candidate.json> --out <private-report.md>

Exit 2 = BLOCKED/invalid inputs, exit 1 = measured quality gate FAIL, exit 0 = scorer PASS. A scorer PASS still needs verified deployments, capabilities, cost cap/accounting, #104/regression acceptance and human release sign-off for issue closure. Never publish these templates as observed quality evidence.
`);
  return { directory: target, comparablePairsPlanned: plan.comparablePairsPlanned,
    callsPlanned: plan.baselineAndCandidateCallsPlanned, status: "UNRUN" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const get = flag => { const index = args.indexOf(flag); return index === -1 ? undefined : args[index + 1]; };
  const directory = get("--out-dir");
  if (!directory) { console.error("Usage: --out-dir <new-private-directory> [--baseline-sha <full SHA>] [--candidate-sha <full SHA>]"); process.exitCode = 2; }
  else {
    try { console.log(JSON.stringify(prepareCapturePackage(directory, {
      baselineSha: get("--baseline-sha") ?? FOUNDATION_BASELINE_SHA,
      candidateSha: get("--candidate-sha") ?? FOUNDATION_CANDIDATE_SHA,
    }))); }
    catch (error) { console.error(error.message); process.exitCode = 2; }
  }
}
