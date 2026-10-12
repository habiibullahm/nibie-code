import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareCapturePackage, capturePlan } from "../../scripts/prepare-response-quality-eval.mjs";
import { comparePhases, loadCases, CATEGORY_COVERAGE_FLOORS, LANGUAGE_COVERAGE_FLOORS,
  coverageBucketForCategory } from "../../scripts/response-quality-eval.mjs";

describe("Unrun response-quality capture package", () => {
  it("covers the requested bilingual rubric in every mode without authorizing extra calls", () => {
    const plan = capturePlan();
    assert.equal(plan.status, "UNRUN");
    assert.equal(plan.comparablePairsPlanned, 21);
    assert.equal(plan.baselineAndCandidateCallsPlanned, 42);
    assert.equal(plan.extraCallsAuthorized, 0);
    for (const bucket of Object.keys(CATEGORY_COVERAGE_FLOORS)) {
      assert.ok(plan.cases.some(item => coverageBucketForCategory(item.category) === bucket));
    }
    for (const language of Object.keys(LANGUAGE_COVERAGE_FLOORS)) {
      assert.ok(plan.cases.some(item => item.language === language));
    }
    assert.ok(plan.cases.some(item => item.context?.history));
    assert.ok(plan.cases.some(item => item.context?.file));
    assert.ok(plan.cases.some(item => item.requestedResponseDepth === "concise"));
    assert.ok(plan.cases.some(item => item.requestedResponseDepth === "detailed"));
  });

  it("keeps real output/rating/budget fields blank, blocks scoring and refuses capture overwrite", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "quality-package-test-"));
    try {
      const directory = path.join(root, "capture");
      const result = prepareCapturePackage(directory);
      assert.equal(result.status, "UNRUN");
      const read = name => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
      const baseline = read("baseline.template.json"), candidate = read("candidate.template.json");
      const manifest = read("manifest.template.json");
      assert.equal(baseline.runs.length, 21);
      assert.equal(candidate.runs.length, 21);
      assert.notEqual(baseline.appCommitSha, candidate.appCommitSha);
      assert.equal(manifest.releaseDecision, "BLOCKED");
      assert.equal(manifest.budget.approvedMaxUsd, null);
      assert.equal(manifest.budget.enforcementVerified, false);
      assert.equal(manifest.independentHumanReviewer, null);
      for (const run of [...baseline.runs, ...candidate.runs]) {
        assert.equal(run.response, null);
        assert.equal(run.reviewer, null);
        assert.equal(run.sourceFidelity, "unreviewed");
        assert.ok(Object.values(run.ratings).every(value => value === null));
      }
      assert.throws(() => comparePhases(baseline, candidate), /Incomplete actual-model output/);
      assert.throws(() => prepareCapturePackage(directory), /EEXIST/);
      assert.equal(read("manifest.template.json").preparedAt, manifest.preparedAt);
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(statSync(path.join(directory, "baseline.template.json")).mode & 0o777, 0o600);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("blocks invalid or identical source SHAs and incomplete fixture plans", () => {
    assert.throws(() => prepareCapturePackage("unused", { baselineSha: "main" }), /Distinct full/);
    const sha = "a".repeat(40);
    assert.throws(() => prepareCapturePackage("unused", { baselineSha: sha, candidateSha: sha }), /Distinct full/);
    assert.throws(() => capturePlan(loadCases().filter(item => item.id !== "brevity-sentence-id")), /Capture fixture missing/);
  });
});
