import { describe, expect, it } from "vitest";
import { detectMemoryIntent } from "../../lib/recall/intent";

describe("memory intent detection", () => {
  it("detects English and Indonesian save intents", () => {
    expect(detectMemoryIntent("Remember that I prefer TypeScript")).toEqual({
      kind: "save",
      raw: "I prefer TypeScript",
    });
    expect(detectMemoryIntent("remember this deploy uses Seoul")).toEqual({
      kind: "save",
      raw: "this deploy uses Seoul",
    });
    expect(detectMemoryIntent("Save this for later: production DB is read-only")).toEqual({
      kind: "save",
      raw: "production DB is read-only",
    });
    expect(detectMemoryIntent("Keep this in mind: always use Balanced for demos")).toEqual({
      kind: "save",
      raw: "always use Balanced for demos",
    });
    expect(detectMemoryIntent("Ingat bahwa saya lebih suka jawaban singkat")).toEqual({
      kind: "save",
      raw: "saya lebih suka jawaban singkat",
    });
    expect(detectMemoryIntent("Simpan ini: proyek Nibie pakai Supabase")).toEqual({
      kind: "save",
      raw: "proyek Nibie pakai Supabase",
    });
    expect(detectMemoryIntent("Ingat untuk percakapan berikutnya: timezone WIB")).toEqual({
      kind: "save",
      raw: "timezone WIB",
    });
  });

  it("detects forget intents", () => {
    expect(detectMemoryIntent("Forget that I prefer TypeScript")).toEqual({
      kind: "forget",
      raw: "I prefer TypeScript",
    });
    expect(detectMemoryIntent("Jangan ingat lagi saya lebih suka jawaban singkat")).toEqual({
      kind: "forget",
      raw: "saya lebih suka jawaban singkat",
    });
    expect(detectMemoryIntent("Lupakan production DB is read-only")).toEqual({
      kind: "forget",
      raw: "production DB is read-only",
    });
  });

  it("rejects transient queries that must not become memory", () => {
    for (const message of [
      "What's IHSG today?",
      "Fix typo in this paragraph",
      "Explain REST",
      "Generate SQL for users table",
      "Summarize file",
      "Remember what is IHSG?",
      "Ingat jelaskan REST",
    ]) {
      expect(detectMemoryIntent(message)).toEqual({ kind: "none" });
    }
  });
});
