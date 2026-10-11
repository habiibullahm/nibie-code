import { describe, expect, it } from "vitest";
import { qaSmokeArgs } from "../../scripts/qa-smoke.mjs";

describe("QA suite selection", () => {
  it("isolates Settings QA from the smoke suite that sends a paid reply", () => {
    const args = qaSmokeArgs(["--settings", "--reporter=line"]);
    expect(args).toEqual(["test", "tests/e2e/settings-preview.spec.ts", "--workers=1", "--reporter=line"]);
    expect(args).not.toContain("tests/e2e/qa-smoke.spec.ts");
  });

  it("keeps the existing chat smoke as the default", () => {
    expect(qaSmokeArgs([])).toEqual(["test", "tests/e2e/qa-smoke.spec.ts", "--workers=1"]);
  });
});
