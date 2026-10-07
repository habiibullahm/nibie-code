import { describe, expect, it } from "vitest";
import { defaultUserPreferences } from "../../lib/preferences/types";
import { parsePreferencePatch } from "../../lib/preferences/validation";

describe("account preference validation", () => {
  it("starts from explicit defaults", () => {
    expect(defaultUserPreferences()).toEqual({
      preferredName: null,
      preferredLanguage: "auto",
      defaultModel: "balanced",
      responseLength: "balanced",
      responseStyle: "natural",
      aboutYou: null,
      recallEnabled: true,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("accepts the supported enums and trims text", () => {
    expect(parsePreferencePatch({ preferredLanguage: "id", defaultModel: "fast", responseLength: "concise", responseStyle: "direct" })).toEqual({
      data: { preferredLanguage: "id", defaultModel: "fast", responseLength: "concise", responseStyle: "direct" },
    });
    expect(parsePreferencePatch({ preferredName: "  Habib  ", aboutYou: "  Builds Nibie  " })).toEqual({
      data: { preferredName: "Habib", aboutYou: "Builds Nibie" },
    });
    expect(parsePreferencePatch({ recallEnabled: false })).toEqual({ data: { recallEnabled: false } });
  });

  it("clears blank text instead of storing an empty string", () => {
    expect(parsePreferencePatch({ preferredName: "   ", aboutYou: "\n" })).toEqual({ data: { preferredName: null, aboutYou: null } });
  });

  it("rejects invalid enums, unknown keys, and a caller-supplied owner", () => {
    for (const patch of [
      { preferredLanguage: "fr" },
      { defaultModel: "Fast" },
      { defaultModel: "turbo" },
      { responseLength: "short" },
      { responseStyle: "friendly" },
      { user_id: "someone-else" },
      { theme: "dark" },
      {},
    ]) {
      expect(parsePreferencePatch(patch)).toEqual({ error: "Choose a valid preference." });
    }
  });

  it("rejects text outside its bounds", () => {
    expect(parsePreferencePatch({ preferredName: "x".repeat(81) })).toEqual({ error: "Preferred name must be 80 characters or fewer, with no line breaks." });
    expect(parsePreferencePatch({ preferredName: "Ha\nbib" })).toEqual({ error: "Preferred name must be 80 characters or fewer, with no line breaks." });
    expect(parsePreferencePatch({ aboutYou: "x".repeat(1501) })).toEqual({ error: "About you must be 1,500 characters or fewer." });
  });
});
