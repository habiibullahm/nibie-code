import { describe, expect, it, vi } from "vitest";
import { readChatSse, readOpenAiSse } from "../../lib/ai/sse";
import { buildContext } from "../../lib/context/build-context";
import type { BuildContextInput, ContextDiagnostics, RoomContextInput } from "../../lib/context/context-types";
import { defaultUserPreferences } from "../../lib/preferences/types";

describe("OpenAI compatible SSE parsing", () => {
  it("preserves events split across network chunks and ignores non-text events", async () => {
    const source = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: [DONE]\n\n";
    const bytes = new TextEncoder().encode(source);
    const chunks = [bytes.slice(0, 42), bytes.slice(42, 71), bytes.slice(71)];
    const body = new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } });
    const events = [];
    for await (const event of readOpenAiSse(body)) events.push(event);
    expect(events).toEqual([{ type: "delta", text: "Hello" }, { type: "done" }]);
  });

  it("handles split UTF-8, CRLF, and an unterminated final DONE line", async () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好 👋"}}]}\r\n\r\ndata: [DONE]');
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    expect(await Array.fromAsync(readOpenAiSse(body))).toEqual([{ type: "delta", text: "你好 👋" }, { type: "done" }]);
  });

  it("fails on provider errors and malformed content events", async () => {
    for (const source of ['data: {"error":{"message":"private detail"}}\n\n', 'data: malformed\n\n']) {
      await expect(Array.fromAsync(readOpenAiSse(bodyOf(source)))).rejects.toThrow();
    }
  });

  it.each(["length", "content_filter", "tool_calls", "unexpected"])("does not treat %s as successful completion", async (reason) => {
    const source = 'data: ' + JSON.stringify({ choices: [{ delta: { content: "partial" } }] }) + '\n\ndata: ' +
      JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] }) + '\n\ndata: [DONE]\n\n';
    await expect(Array.fromAsync(readOpenAiSse(bodyOf(source)))).rejects.toThrow();
  });

  it("preserves a normal finish reason across split chunks and refuses premature EOF", async () => {
    const source = 'data: {"choices":[{"delta":{"content":"complete"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(source);
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    expect(await Array.fromAsync(readOpenAiSse(body))).toEqual([{ type: "delta", text: "complete" }, { type: "done", finishReason: "stop" }]);
    await expect(Array.fromAsync(readOpenAiSse(bodyOf('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')))).rejects.toThrow("before completion");
  });

  it("completes on a stop finish reason when the gateway closes without DONE, but keeps non-stop reasons as failures", async () => {
    const tail = (reason: string) => 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"' + reason + '"}]}\n\n';
    expect(await Array.fromAsync(readOpenAiSse(bodyOf(tail("stop"))))).toEqual([{ type: "delta", text: "answer" }, { type: "done", finishReason: "stop" }]);
    await expect(Array.fromAsync(readOpenAiSse(bodyOf(tail("length"))))).rejects.toThrow("output limit");
  });

  it("cancels a pending provider reader on abort", async () => {
    const cancel = vi.fn();
    const aborter = new AbortController();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const pending = Array.fromAsync(readOpenAiSse(body, aborter.signal));
    aborter.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("requires the client stream to confirm persistence before DONE", async () => {
    const start = 'event: start\ndata: {"id":"e3b624e6-d792-47a8-8ff2-46724452c1ca","position":2}\n\n';
    const delta = 'event: delta\ndata: {"text":"Hello"}\n\n';
    const status = 'event: status\ndata: {"status":"complete"}\n\n';
    const done = 'event: done\ndata: {}\n\n';
    expect(await Array.fromAsync(readChatSse(bodyOf(start + delta + status + done)))).toHaveLength(4);
    await expect(Array.fromAsync(readChatSse(bodyOf(start + delta)))).rejects.toThrow("before it was saved");
    await expect(Array.fromAsync(readChatSse(bodyOf(start + delta + done)))).rejects.toThrow("before it was saved");
    await expect(Array.fromAsync(readChatSse(bodyOf('event: error\ndata: {"error":"Response unavailable."}\n\n')))).rejects.toThrow("Response unavailable");
  });
});

const room: RoomContextInput = { name: "Clinic", instructions: "Plan a clinic assistant", brief: null, pins: [] };
const pin = { id: "pin", title: "Scope", content: "Appointment scheduling only", updatedAt: "2026-10-03T00:00:00.000Z" };
const files = [{ name: "notes.txt", text: "The prototype should support appointment scheduling." }];
const diagnosticCases: [string, Partial<BuildContextInput>][] = [
  ["general chat", {}],
  ["room without pins or selected files", { room }],
  ["room with pins", { room: { ...room, pins: [pin] } }],
  ["room with a selected file", { room, files }],
  ["room with pins and a selected file", { room: { ...room, pins: [pin] }, files }],
  ["room without instructions, pins, or selected files", { room: { ...room, instructions: null }, files: [] }],
];
const id = "e3b624e6-d792-47a8-8ff2-46724452c1ca";
const eventOf = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const terminal = eventOf("delta", { text: "Hello" }) + eventOf("status", { status: "complete" }) + eventOf("done", {});
const source = { type: "pins", label: "Pinned context", state: "not_used", reason: "No pins in this room." };

describe("chat SSE diagnostic contract", () => {
  it.each(diagnosticCases)("accepts Context Engine output for %s through completion", async (_name, overrides) => {
    const context = buildContext({
      capabilities: { contextWindowTokens: 16_384, maxOutputTokens: 2_048 },
      preferences: { ...defaultUserPreferences(), preferredName: "Tester" },
      preferenceReadFailed: false, summary: null,
      messages: [{ role: "user", content: "hello", position: 1 }], currentPosition: 1,
      ...overrides,
    }).diagnostics;
    const cancel = vi.fn();
    const events = await Array.fromAsync(readChatSse(bodyOf(eventOf("start", { id, position: 2, context }) + terminal, cancel)));
    expect(events).toEqual([{ type: "start", id, position: 2, context }, { type: "delta", text: "Hello" }, { type: "status", status: "complete" }, { type: "done" }]);
    expect(cancel).not.toHaveBeenCalled();
    expect(context.sources.find((item) => item.type === "pins")?.state).toBe(overrides.room ? overrides.room.pins?.length ? "included" : "not_used" : undefined);
    expect(context.sources.find((item) => item.type === "file")?.state).toBe(overrides.files?.length ? "included" : undefined);
  });

  it("accepts empty and unused sources across split UTF-8 and CRLF chunks", async () => {
    const context: ContextDiagnostics = { sources: [
      { type: "room", label: "This room", state: "not_used", reason: "No room brief." },
      { type: "pins", label: "Pinned context", state: "not_used", reason: "No pins." },
      { type: "file", label: "File context", state: "not_used", reason: "Not used for this reply." },
    ], recentMessageCount: 0 };
    const text = eventOf("start", { id, position: 2, context }) + eventOf("delta", { text: "你好 👋" }) + eventOf("status", { status: "complete" }) + eventOf("done", {});
    const bytes = new TextEncoder().encode(text.replaceAll("\n", "\r\n"));
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    expect(await Array.fromAsync(readChatSse(body))).toEqual([{ type: "start", id, position: 2, context }, { type: "delta", text: "你好 👋" }, { type: "status", status: "complete" }, { type: "done" }]);
  });

  it.each([
    null, [], "pins", { ...source, type: "unknown" }, { ...source, type: false },
    { ...source, label: "Unknown label" }, { ...source, label: 1 }, { ...source, state: true },
    { ...source, reason: 1 }, { ...source, count: 0 }, { ...source, count: "zero" },
    { ...source, extra: true }, { type: "file", label: "File context", state: "included" },
    { type: "file", label: "File context", state: "included", reason: [], count: 1 },
    { type: "file", label: "File context", state: "not_used", reason: "Unused", count: "one" },
  ].map((diagnostic) => [diagnostic]))("rejects malformed or unsupported source metadata: %j", async (diagnostic) => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode(eventOf("start", { id, position: 2, context: { sources: [diagnostic], recentMessageCount: 1 } }));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); }, cancel });
    await expect(Array.fromAsync(readChatSse(body))).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    { sources: [source], recentMessageCount: -1 }, { sources: [source], recentMessageCount: 0.5 },
    { sources: [source], recentMessageCount: "1" }, { sources: {}, recentMessageCount: 1 },
    { sources: [source], recentMessageCount: 1, extra: true },
  ])("rejects malformed context envelopes: %j", async (context) => {
    await expect(Array.fromAsync(readChatSse(bodyOf(eventOf("start", { id, position: 2, context }) + terminal)))).rejects.toThrow();
  });

  it.each([
    eventOf("start", { id: "invalid", position: 2 }), eventOf("start", { id, position: 0 }),
    eventOf("start", { id, position: 2, extra: true }), eventOf("unknown", {}),
    eventOf("start", null), eventOf("start", []), "event: start\ndata: malformed\n\n",
    eventOf("start", { id, position: 2 }) + eventOf("delta", { text: 1 }),
    eventOf("start", { id, position: 2 }) + eventOf("delta", { text: "Hello", extra: true }),
    eventOf("start", { id, position: 2 }) + eventOf("status", { status: "complete", extra: true }),
    eventOf("error", { error: "Failed", extra: true }),
    eventOf("start", { id, position: 2 }) + eventOf("status", { status: "complete" }) + eventOf("done", { extra: true }),
    eventOf("delta", { text: "Before start" }),
    eventOf("start", { id, position: 2 }) + eventOf("start", { id, position: 2 }),
    eventOf("start", { id, position: 2 }) + eventOf("status", { status: "complete" }) + eventOf("delta", { text: "After status" }),
  ])("rejects malformed events and ordering: %j", async (text) => {
    await expect(Array.fromAsync(readChatSse(bodyOf(text)))).rejects.toThrow();
  });
});

function bodyOf(source: string, cancel?: () => void) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(source)); controller.close(); }, cancel });
}
