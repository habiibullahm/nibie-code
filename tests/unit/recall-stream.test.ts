import { describe, expect, it } from "vitest";
import { readChatSse } from "../../lib/ai/sse";
import { buildContext } from "../../lib/context/build-context";
import { defaultUserPreferences } from "../../lib/preferences/types";
import type { MemoryRecord } from "../../lib/recall/types";

const memory: MemoryRecord = {
  id: "11111111-1111-4111-8111-111111111111", type: "preference",
  content: "Prefer TypeScript", normalizedKey: "prefer typescript", isActive: true,
  sourceConversationId: null, sourceMessageId: null, lastUsedAt: null,
  createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
};
const frame = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

describe("Recall diagnostics across the chat stream", () => {
  it.each(["start", "context"] as const)("accepts memory context in the %s event without leaking memory text", async (eventType) => {
    const context = buildContext({
      capabilities: { contextWindowTokens: 16_384, maxOutputTokens: 2_048 },
      preferences: defaultUserPreferences(), preferenceReadFailed: false, summary: null,
      messages: [{ role: "user", content: "Show an example", position: 1 }],
      currentPosition: 1, memories: [memory],
    }).diagnostics;
    expect(context.sources).toContainEqual(expect.objectContaining({ type: "memory", label: "Saved memories", state: "included" }));
    expect(JSON.stringify(context)).not.toContain(memory.content);
    const start = { id: "22222222-2222-4222-8222-222222222222", position: 2 };
    const source = frame("start", eventType === "start" ? { ...start, context } : start)
      + (eventType === "context" ? frame("context", { context }) : "")
      + frame("delta", { text: "Use TypeScript." }) + frame("status", { status: "complete" }) + frame("done", {});
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(source)); controller.close(); } });
    const events = await Array.fromAsync(readChatSse(body));
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
