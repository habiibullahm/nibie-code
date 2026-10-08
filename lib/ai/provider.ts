import "server-only";

import type { ChatModel } from "@/lib/chat/validation";
import { getAiConfig, resolveRoute, type ModelRoute, type ProviderId } from "./registry";

export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatProvider = { stream(model: ChatModel, messages: ProviderMessage[], signal: AbortSignal): Promise<ReadableStream<Uint8Array>> };

// Sumopod (Fast) and OpenAI (Balanced, High) both stream Chat Completions, so they share the transport and the SSE reader, but each
// provider owns the request it sends. Only OpenAI may carry a reasoning effort, and only when the server configured one.
// stream_options.include_usage asks for a final usage object when the gateway supports it; absence falls back to explicit estimates.
type RequestBody = {
  model: string;
  messages: ProviderMessage[];
  stream: true;
  stream_options?: { include_usage: true };
  reasoning_effort?: string;
  max_tokens?: number;
};
const requestBodies: Record<ProviderId, (route: ModelRoute, messages: ProviderMessage[]) => RequestBody> = {
  sumopod: (route, messages) => ({
    model: route.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(route.maxOutputTokens ? { max_tokens: route.maxOutputTokens } : {}),
  }),
  openai: (route, messages) => ({
    model: route.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(route.reasoningEffort ? { reasoning_effort: route.reasoningEffort } : {}),
  }),
};

export const openAiCompatibleProvider: ChatProvider = {
  async stream(mode, messages, signal) {
    const route = resolveRoute(mode, getAiConfig());
    let response: Response;
    try {
      response = await fetch(`${route.baseUrl}/chat/completions`, {
        method: "POST", signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${route.apiKey}` },
        body: JSON.stringify(requestBodies[route.provider](route, messages)),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error("AI provider request failed.");
    }
    if (!response.ok || !response.body) throw new Error("AI provider request failed.");
    return response.body;
  },
};

export const chatProvider: ChatProvider = openAiCompatibleProvider;

/** Safe telemetry model label from the configured route (never the API key). */
export function configuredModelLabel(mode: ChatModel): string {
  try {
    return resolveRoute(mode, getAiConfig()).model.slice(0, 64);
  } catch {
    return mode;
  }
}
