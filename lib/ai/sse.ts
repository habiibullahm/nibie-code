import { z } from "zod";

export type OpenAiStreamEvent = { type: "delta"; text: string } | { type: "done"; finishReason?: string };

const finishErrors: Record<string, string> = {
  length: "The model reached its output limit before finishing. Please retry or ask it to continue.",
  content_filter: "The provider could not finish this response because of its content filter.",
  tool_calls: "The provider requested a tool that is unavailable in this chat.",
  function_call: "The provider requested a tool that is unavailable in this chat.",
  unknown: "The provider did not finish this response normally. Please try again.",
};
export class ProviderStreamError extends Error {
  constructor(public readonly finishReason: string) {
    super(finishErrors[finishReason] ?? finishErrors.unknown);
  }
}

export async function* readOpenAiSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<OpenAiStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let finishReason: string | undefined;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Response aborted.");
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new Error("Response aborted.");
      buffer += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          if (finishReason && finishReason !== "stop") throw new ProviderStreamError(finishReason);
          yield { type: "done", ...(finishReason ? { finishReason } : {}) };
          return;
        }
        const parsed = JSON.parse(payload) as { error?: unknown; choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[] } | null;
        if (!parsed || parsed.error) throw new Error("AI provider stream failed.");
        const choice = parsed.choices?.[0];
        const text = choice?.delta?.content;
        if (typeof text === "string" && text) {
          if (finishReason) throw new Error("Invalid provider response stream.");
          yield { type: "delta", text };
        }
        if (choice?.finish_reason != null) {
          const reason = choice.finish_reason;
          finishReason = typeof reason === "string" && (reason === "stop" || Object.hasOwn(finishErrors, reason)) ? reason : "unknown";
        }
      }
      if (done) {
        // Some compatible gateways close after the final finish_reason without a [DONE] line.
        if (finishReason === "stop") { yield { type: "done", finishReason }; return; }
        if (finishReason) throw new ProviderStreamError(finishReason);
        throw new Error("Provider stream ended before completion.");
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

const contextDiagnosticSchema = z.strictObject({
  type: z.enum(["profile", "room", "pins", "file", "thread_summary", "recent_messages"]),
  label: z.enum(["Your profile", "This room", "Pinned context", "File context", "Thread summary", "Recent conversation"]),
  state: z.enum(["included", "not_used"]),
  reason: z.string(),
});

const chatEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("start"),
    id: z.string().uuid(),
    position: z.number().int().positive(),
    context: z.strictObject({ sources: z.array(contextDiagnosticSchema), recentMessageCount: z.number().int().nonnegative() }).optional(),
  }),
  z.strictObject({ type: z.literal("delta"), text: z.string() }),
  z.strictObject({ type: z.literal("status"), status: z.enum(["complete", "interrupted"]) }),
  z.strictObject({ type: z.literal("error"), error: z.string() }),
  z.strictObject({ type: z.literal("done") }),
]);
export type ChatStreamEvent = z.infer<typeof chatEventSchema>;

// Thrown only when the server itself reported a failed response (an `error` event). Any other stream problem is transport-level.
export class ChatStreamServerError extends Error {}

export async function* readChatSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let started = false;
  let terminal = false;
  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() + "\n\n" : decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        if (!block.trim() || block.startsWith(":")) continue;
        const type = block.match(/^event: ([^\r\n]+)$/m)?.[1];
        const payload: unknown = JSON.parse(block.match(/^data: ([^\r\n]+)$/m)?.[1] ?? "null");
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid response stream.");
        const event = chatEventSchema.parse({ ...payload, type });
        if (event.type === "error") throw new ChatStreamServerError(event.error);
        if (finished || (event.type === "start" ? started : !started) || (terminal && event.type !== "done")) throw new Error("Invalid response stream.");
        if (event.type === "start") started = true;
        if (event.type === "status") terminal = true;
        if (event.type === "done") {
          if (!terminal) throw new Error("Response ended before it was saved.");
          finished = true;
        }
        yield event;
      }
      if (done) break;
    }
    if (!finished) throw new Error("Response ended before it was saved.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
