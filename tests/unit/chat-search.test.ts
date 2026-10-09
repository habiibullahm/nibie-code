import { describe, expect, it } from "vitest";
import {
  assembleSearchPayload,
  escapeIlikePattern,
  extractSnippet,
  highlightMatchParts,
  ilikeContainsPattern,
  mapOwnedSearchRows,
  normalizeSearchQuery,
  sanitizeSearchableContent,
  SEARCH_MAX_QUERY,
  SEARCH_MAX_RESULTS,
  searchLocalConversations,
} from "../../lib/chat/search";

describe("chat search helpers", () => {
  it("normalizes and caps queries", () => {
    expect(normalizeSearchQuery("  hello   world  ")).toBe("hello world");
    expect(normalizeSearchQuery("   ")).toBeNull();
    expect(normalizeSearchQuery(1)).toBeNull();
    expect(normalizeSearchQuery("x".repeat(SEARCH_MAX_QUERY + 20))?.length).toBe(SEARCH_MAX_QUERY);
  });

  it("removes LIKE metacharacters from DB patterns and keeps a contains wrapper", () => {
    expect(escapeIlikePattern("100%_done\\")).toBe("100done");
    expect(ilikeContainsPattern("auth")).toBe("%auth%");
    expect(ilikeContainsPattern("%_%")).toBeNull();
  });

  it("extracts a match-centered snippet and caps length", () => {
    const content = `${"a ".repeat(80)}unique-phrase-xyz ${"b ".repeat(80)}`;
    const snippet = extractSnippet(content, "unique-phrase-xyz", 80);
    expect(snippet).toContain("unique-phrase-xyz");
    expect(snippet.length).toBeLessThanOrEqual(82);
    expect(snippet.startsWith("…") || snippet.includes("unique-phrase-xyz")).toBe(true);
  });

  it("splits highlight parts into safe text nodes", () => {
    expect(highlightMatchParts("Hello RLS world", "rls")).toEqual([
      { text: "Hello ", match: false },
      { text: "RLS", match: true },
      { text: " world", match: false },
    ]);
    expect(highlightMatchParts("plain", "")).toEqual([{ text: "plain", match: false }]);
  });

  it("sanitizes assistant reasoning before snippets", () => {
    expect(sanitizeSearchableContent("assistant", "<think>secret</think>Visible answer")).toBe("Visible answer");
    expect(sanitizeSearchableContent("user", "<think>keep</think>")).toBe("<think>keep</think>");
  });

  it("orders title matches before messages and caps results", () => {
    const titleHits = Array.from({ length: 10 }, (_, index) => ({
      kind: "conversation" as const,
      conversationId: `c${index}`,
      title: `Title ${index}`,
      roomId: null,
      roomName: null,
      archived: false,
    }));
    const messageHits = Array.from({ length: 30 }, (_, index) => ({
      kind: "message" as const,
      conversationId: `m${index}`,
      messageId: `msg${index}`,
      title: `Msg ${index}`,
      snippet: "hit",
      role: "user" as const,
      roomId: null,
      roomName: null,
      archived: false,
    }));
    const payload = assembleSearchPayload({ query: "hit", titleHits, messageHits });
    expect(payload.conversations).toHaveLength(10);
    expect(payload.messages.length).toBe(SEARCH_MAX_RESULTS - 10);
    expect(payload.conversations.length + payload.messages.length + payload.archived.length).toBeLessThanOrEqual(SEARCH_MAX_RESULTS);
  });

  it("maps owned rows with room labels and excludes non-matching sanitized content", () => {
    const payload = mapOwnedSearchRows({
      query: "constellations",
      conversations: [
        { id: "c1", title: "Astronomy", room_id: "r1", archived_at: null },
        { id: "c2", title: "Other", room_id: null, archived_at: "2026-01-01" },
      ],
      messages: [
        { id: "m1", conversation_id: "c1", role: "assistant", content: "bright constellations tonight" },
        { id: "m2", conversation_id: "c2", role: "user", content: "constellations archive note" },
        { id: "m3", conversation_id: "c1", role: "assistant", content: "<think>constellations</think>No match left" },
      ],
      rooms: [{ id: "r1", name: "Nibie Development" }],
    });
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({
      messageId: "m1",
      roomName: "Nibie Development",
      snippet: expect.stringContaining("constellations"),
    });
    expect(payload.archived).toHaveLength(1);
    expect(payload.archived[0]).toMatchObject({ kind: "message", messageId: "m2", archived: true });
  });

  it("searches local preview corpora including Indonesian and Unicode", () => {
    const payload = searchLocalConversations(
      [
        {
          id: "c1",
          title: "Catatan proyek",
          room_id: null,
          messages: [{ id: "m1", role: "user", content: "Perlu migrasi data ke Supabase dengan aman ✨", status: "complete" }],
        },
      ],
      [],
      "migrasi data",
    );
    expect(payload?.messages[0]?.snippet).toContain("migrasi data");
  });

  it("treats literal % and _ as plain text in local search", () => {
    const payload = searchLocalConversations(
      [
        {
          id: "c1",
          title: "Rates",
          room_id: null,
          messages: [{ id: "m1", role: "user", content: "Progress is at 100%_done", status: "complete" }],
        },
      ],
      [],
      "100%_",
    );
    expect(payload?.messages).toHaveLength(1);
  });

  it("excludes non-complete messages from local search", () => {
    const payload = searchLocalConversations(
      [
        {
          id: "c1",
          title: "Streaming",
          room_id: null,
          messages: [
            { id: "m1", role: "assistant", content: "secret-streaming-token", status: "streaming" },
            { id: "m2", role: "assistant", content: "secret-streaming-token final", status: "complete" },
          ],
        },
      ],
      [],
      "secret-streaming-token",
    );
    expect(payload?.messages.map((hit) => hit.messageId)).toEqual(["m2"]);
  });
});
