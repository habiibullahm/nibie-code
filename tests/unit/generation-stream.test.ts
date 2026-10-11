import { describe, expect, it, vi } from "vitest";
import { createGenerationStream } from "@/lib/chat/orchestration/stream-response";
import type { createGenerationLifecycle } from "@/lib/chat/orchestration/generation-lifecycle";
import type { GenerationPersistResult } from "@/lib/chat/orchestration/persist-result";

vi.mock("@/lib/observability/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

function fixture(path: "ordinary" | "action", chunks: string[], reason = "stop") {
  const aborter = new AbortController();
  const flags = { clientCancelled: false, userStopped: false, providerTimedOut: false };
  const lifecycle = {
    signal: aborter.signal,
    get clientCancelled() { return flags.clientCancelled; },
    get userStopped() { return flags.userStopped; },
    get providerTimedOut() { return flags.providerTimedOut; },
  } as ReturnType<typeof createGenerationLifecycle>;
  const persistence = {
    persist: vi.fn(async (): Promise<GenerationPersistResult> => "saved"),
    persistCitationSourcesForKeptReply: vi.fn(async () => undefined),
  };
  const events: { type: string; data: unknown }[] = [];
  const onComplete = vi.fn();
  const wire = chunks.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join("")
    + `data: ${JSON.stringify({ choices: [{ finish_reason: reason }], usage: { prompt_tokens: 12, completion_tokens: 4 } })}\n\ndata: [DONE]\n\n`;
  const generation = createGenerationStream({
    responseStream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(wire)); controller.close(); } }),
    lifecycle, persistence, requestId: "request", assistantId: "assistant", providerStartedAt: Date.now(), durationMs: () => 1,
    sources: [{ id: "web:1", kind: "web", title: "Source", url: "https://example.com", domain: "example.com" }],
    emit: (type, data) => events.push({ type, data }), path, onComplete,
    interrupted: () => flags.userStopped || flags.clientCancelled || (path === "action" && aborter.signal.aborted),
  });
  return { generation, flags, aborter, persistence, events, onComplete };
}

describe.each(["ordinary", "action"] as const)("%s shared generation stream", (path) => {
  it("filters split reasoning and citations, saves the exact visible text, and consumes only once", async () => {
    const test = fixture(path, ["<thi", "nk>hidden</think>Answer [SOURCE:", "web:1]."]);
    await Promise.all([test.generation.run(), test.generation.run()]);
    expect(test.generation.output).toBe("Answer [1].");
    expect(test.persistence.persist).toHaveBeenCalledExactlyOnceWith("Answer [1].", "complete");
    expect(test.events.filter((event) => event.type === "delta").map((event) => (event.data as { text: string }).text).join("")).toBe(test.generation.output);
    expect(test.events.at(-1)).toEqual({ type: "status", data: { status: "complete" } });
    expect(test.generation.providerUsage).toMatchObject({ inputTokens: 12, outputTokens: 4, source: "provider" });
    expect(test.onComplete).toHaveBeenCalledOnce();
  });

  it("never advertises completion when Stop wins the conditional save", async () => {
    const test = fixture(path, ["Answer"]);
    test.persistence.persist.mockResolvedValueOnce("stopped");
    await test.generation.run();
    expect(test.events.at(-1)).toEqual({ type: "status", data: { status: "interrupted" } });
    expect(test.onComplete).not.toHaveBeenCalled();
  });

  it("reports persistence failure and retains the existing conditional error-save fallback", async () => {
    const test = fixture(path, ["Answer"]);
    test.persistence.persist.mockResolvedValue("failed");
    await test.generation.run();
    expect(test.persistence.persist.mock.calls).toEqual([["Answer", "complete"], ["Answer", "error"]]);
    expect(test.events.at(-1)?.type).toBe("error");
    expect(test.onComplete).not.toHaveBeenCalled();
  });

  it("keeps a partial as error when the provider hits its output limit", async () => {
    const test = fixture(path, ["Partial [SOURCE:web:1"], "length");
    await test.generation.run();
    expect(test.generation.finishReason).toBe("length");
    expect(test.generation.output).toBe("Partial ");
    expect(test.persistence.persist).toHaveBeenCalledWith("Partial ", "error");
    expect(test.events.at(-1)).toMatchObject({ type: "error", data: { error: expect.stringContaining("output limit") } });
  });

  it("attaches sources after an observed Stop without writing over its content", async () => {
    const test = fixture(path, ["Answer [SOURCE:web:1]."]);
    test.flags.userStopped = true;
    await test.generation.run();
    expect(test.persistence.persist).not.toHaveBeenCalled();
    expect(test.persistence.persistCitationSourcesForKeptReply).toHaveBeenCalledExactlyOnceWith("Answer [1].");
    expect(test.events.at(-1)).toEqual({ type: "status", data: { status: "interrupted" } });
  });

  it("preserves the path's existing provider-timeout classification", async () => {
    const test = fixture(path, []);
    test.flags.providerTimedOut = true;
    test.aborter.abort();
    await test.generation.run();
    expect(test.persistence.persist).toHaveBeenCalledWith(path === "action" ? "Response stopped." : "Response unavailable.", path === "action" ? "interrupted" : "error");
    expect(test.events.at(-1)?.type).toBe(path === "action" ? "status" : "error");
  });
});
