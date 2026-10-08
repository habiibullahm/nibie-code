import { describe, expect, it } from "vitest";
import {
  TRANSCRIPT_MAX_CHARS,
  TRANSCRIPT_MAX_MESSAGES,
  buildTranscriptText,
  formatTranscriptMarkdown,
  formatTranscriptPlain,
  selectTranscriptTurns,
  transcriptFilename,
} from "../../lib/chat/transcript";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-03-01T12:00:00.000Z",
};

describe("chat transcript formatting", () => {
  it("orders turns, labels roles, and notes interrupted assistants", () => {
    const turns = selectTranscriptTurns([
      { ...base, id: "a", role: "assistant", content: "Second", status: "complete", position: 2, created_at: "2026-03-01T12:00:02.000Z" },
      { ...base, id: "u", role: "user", content: "First", status: "complete", position: 1, created_at: "2026-03-01T12:00:01.000Z" },
      { ...base, id: "s", role: "assistant", content: "Partial", status: "interrupted", position: 3, created_at: "2026-03-01T12:00:03.000Z" },
    ]);
    expect(turns?.map((turn) => turn.id)).toEqual(["u", "a", "s"]);
    const plain = formatTranscriptPlain("Launch notes", turns!);
    expect(plain).toContain("Launch notes");
    expect(plain).toContain("User (2026-03-01T12:00:01.000Z)");
    expect(plain).toContain("Assistant · Stopped (2026-03-01T12:00:03.000Z)");
    expect(plain.indexOf("First")).toBeLessThan(plain.indexOf("Second"));
  });

  it("strips hidden reasoning and omits streaming/error placeholders", () => {
    const turns = selectTranscriptTurns([
      { ...base, id: "1", role: "user", content: "Hi", status: "complete", position: 1 },
      { ...base, id: "2", role: "assistant", content: "<think>secret</think>Visible **bold**", status: "complete", position: 2 },
      { ...base, id: "3", role: "assistant", content: "…", status: "streaming", position: 3 },
      { ...base, id: "4", role: "assistant", content: "failed", status: "error", position: 4 },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns![1].content).toBe("Visible **bold**");
    const plain = formatTranscriptPlain("T", turns!);
    expect(plain).not.toContain("secret");
    expect(plain).not.toContain("<think>");
    expect(plain).not.toContain("**");
    expect(plain).toContain("Visible bold");
    expect(plain).not.toContain("failed");
  });

  it("keeps Markdown structure in downloads and preserves Unicode", () => {
    const turns = selectTranscriptTurns([
      { ...base, id: "1", role: "user", content: "Apa kabar? 你好", status: "complete", position: 1 },
      {
        ...base,
        id: "2",
        role: "assistant",
        content: "## Heading\n\n```ts\nconst x = 1;\n```\n\n- item\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nSee [1].",
        status: "complete",
        position: 2,
      },
    ]);
    const md = formatTranscriptMarkdown("Catatan", turns!);
    expect(md).toContain("# Catatan");
    expect(md).toContain("## Assistant");
    expect(md).toContain("```ts");
    expect(md).toContain("| a | b |");
    expect(md).toContain("Apa kabar? 你好");
    expect(md).toContain("See [1].");
  });

  it("builds a safe filename and fails closed on oversized transcripts", () => {
    expect(transcriptFilename('My "Chat"/Notes')).toBe("my-chat-notes.md");
    expect(transcriptFilename("../../../etc/passwd")).toBe("etc-passwd.md");
    expect(transcriptFilename("")).toBe("conversation.md");

    const tooMany = Array.from({ length: TRANSCRIPT_MAX_MESSAGES + 1 }, (_, index) => ({
      ...base,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      role: "user",
      content: "x",
      status: "complete",
      position: index + 1,
    }));
    expect(buildTranscriptText({ id: base.id, title: "Big" }, tooMany, "plain")).toMatchObject({
      error: "This conversation is too large to export as a transcript.",
      status: 413,
    });

    const huge = [{
      ...base,
      id: "22222222-2222-4222-8222-222222222222",
      role: "user" as const,
      content: "y".repeat(TRANSCRIPT_MAX_CHARS + 10),
      status: "complete",
      position: 1,
    }];
    expect(buildTranscriptText({ id: base.id, title: "Huge" }, huge, "plain")).toMatchObject({ status: 413 });
  });

  it("leaves user text that looks like reasoning tags unchanged", () => {
    const turns = selectTranscriptTurns([
      { ...base, id: "1", role: "user", content: "<think>not model</think>", status: "complete", position: 1 },
    ]);
    expect(turns![0].content).toBe("<think>not model</think>");
  });
});
