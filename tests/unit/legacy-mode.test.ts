import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelChoiceInputSchema, modelInputSchema, normalizeSavedMode } from "../../lib/chat/legacy-mode";
import { modelChoiceSchema } from "../../lib/chat/models";
import { modelSchema } from "../../lib/chat/validation";

describe("legacy Reasoning compatibility (server side)", () => {
  it("normalizes saved values from earlier builds to the closest mode", () => {
    for (const mode of ["Fast", "Balanced", "High"]) expect(normalizeSavedMode(mode)).toBe(mode);
    expect(normalizeSavedMode("Reasoning")).toBe("High");
    expect(normalizeSavedMode("reasoning")).toBe("High");
    expect(normalizeSavedMode(" balanced ")).toBe("Balanced");
    expect(normalizeSavedMode("MiniMax M2.7")).toBe("Fast");
    expect(normalizeSavedMode("DeepSeek V4.1 Flash")).toBe("Balanced");
    expect(normalizeSavedMode("GPT-6 Luna")).toBe("High");
    for (const value of ["default", "Auto", "turbo", "", undefined, 3, null]) expect(normalizeSavedMode(value)).toBeNull();
  });

  it("accepts the exact old request id Reasoning as High, and stays strict about everything else", () => {
    expect(modelInputSchema.parse("Reasoning")).toBe("High");
    expect(modelChoiceInputSchema.parse("Reasoning")).toBe("High");
    expect(modelChoiceInputSchema.parse("Auto")).toBe("Auto");
    for (const value of ["High", "Fast", "Balanced"]) expect(modelInputSchema.parse(value)).toBe(value);
    for (const value of ["reasoning", "high", "fast", "gpt-6.1-sol", "", 7, null, { id: "Fast" }]) {
      expect(modelInputSchema.safeParse(value).success).toBe(false);
      expect(modelChoiceInputSchema.safeParse(value).success).toBe(false);
    }
  });

  it("the client-facing schemas know only Fast, Balanced, High (and Auto for a choice)", () => {
    expect(modelSchema.options).toEqual(["Fast", "Balanced", "High"]);
    expect(modelSchema.safeParse("Reasoning").success).toBe(false);
    expect(modelChoiceSchema.safeParse("Reasoning").success).toBe(false);
    expect(modelChoiceSchema.safeParse("Auto").success).toBe(true);
  });

  it("is never imported by client code", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(root, dir))) {
        const path = join(dir, name);
        if (statSync(join(root, path)).isDirectory()) { walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(join(root, path), "utf8");
        const isClient = /^\s*["']use client["']/.test(text);
        if (text.includes("legacy-mode") && (isClient || path.startsWith("components"))) offenders.push(path);
      }
    };
    for (const dir of ["components", "app", "lib", "tests/fixtures"]) walk(dir);
    expect(offenders).toEqual([]);
  });
});
