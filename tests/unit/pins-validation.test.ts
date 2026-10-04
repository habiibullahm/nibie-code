import { describe, expect, it } from "vitest";
import { parsePinDraft } from "../../lib/pins/validation";

describe("pin validation", () => {
  it("trims a title and content and keeps a single pin draft", () => {
    expect(parsePinDraft({ title: "  Deployment rule  ", content: "  Stay in Seoul.\nUser data stays owner-scoped.  " })).toEqual({
      data: { title: "Deployment rule", content: "Stay in Seoul.\nUser data stays owner-scoped." },
    });
  });

  it("rejects a blank title, a long title, and a title with a line break", () => {
    expect(parsePinDraft({ title: "   ", content: "Kept on purpose." })).toMatchObject({ error: "Pin titles must be 80 characters or fewer, with no line breaks." });
    expect(parsePinDraft({ title: "a".repeat(81), content: "Kept on purpose." })).toMatchObject({ error: "Pin titles must be 80 characters or fewer, with no line breaks." });
    expect(parsePinDraft({ title: "Line\nbreak", content: "Kept on purpose." })).toMatchObject({ error: "Pin titles must be 80 characters or fewer, with no line breaks." });
  });

  it("rejects empty or oversized content", () => {
    expect(parsePinDraft({ title: "Rule", content: "   " })).toMatchObject({ error: "Pin content must be 1,000 characters or fewer." });
    expect(parsePinDraft({ title: "Rule", content: "a".repeat(1001) })).toMatchObject({ error: "Pin content must be 1,000 characters or fewer." });
  });

  it("rejects an owner, a room, or any other client field", () => {
    expect(parsePinDraft({ title: "Rule", content: "Kept on purpose.", user_id: "someone-else" })).toMatchObject({ error: "Choose a valid pin." });
    expect(parsePinDraft({ title: "Rule", content: "Kept on purpose.", room_id: "11111111-1111-4111-8111-111111111111" })).toMatchObject({ error: "Choose a valid pin." });
    expect(parsePinDraft({ title: "Rule", content: "Kept on purpose.", extra: true })).toMatchObject({ error: "Choose a valid pin." });
  });
});
