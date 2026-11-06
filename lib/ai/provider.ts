import "server-only";

import type { ChatModel } from "@/lib/chat/validation";
import { getAiConfig, resolveRoute, type ModelRoute, type ProviderId } from "./registry";
import { mapProviderFailure, ProviderRequestError } from "./provider-error";

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
  temperature?: number;
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
  openai_compatible: (route, messages) => ({
    model: route.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(typeof route.temperature === "number" ? { temperature: route.temperature } : {}),
    ...(route.maxOutputTokens ? { max_tokens: route.maxOutputTokens } : {}),
  }),
};

export async function streamRoute(route: ModelRoute, messages: ProviderMessage[], signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  let response: Response;
  try {
    response = await fetch(`${route.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${route.apiKey}` },
      body: JSON.stringify(requestBodies[route.provider](route, messages)),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ProviderRequestError("unavailable", null);
  }
  if (response.status >= 300 && response.status < 400) throw new ProviderRequestError("unavailable", response.status);
  if (!response.ok || !response.body) {
    const code = await readErrorCode(response);
    throw mapProviderFailure(response.status, code);
  }
  return response.body;
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (text.length > 4096) return null;
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === "string" ? parsed.error.code.slice(0, 64) : null;
  } catch {
    return null;
  }
}

export const openAiCompatibleProvider: ChatProvider = {
  async stream(mode, messages, signal) {
    return streamRoute(resolveRoute(mode, getAiConfig()), messages, signal);
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
