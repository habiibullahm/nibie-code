import "server-only";
import { mapProviderFailure, ProviderRequestError } from "@/lib/ai/provider-error";

type Input = { baseUrl: string; apiKey: string; signal: AbortSignal };

async function request(url: string, apiKey: string, signal: AbortSignal, body?: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      signal,
      headers: { authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ProviderRequestError("unavailable", null);
  }
}

export async function listProviderModels(input: Input): Promise<string[]> {
  const response = await request(`${input.baseUrl}/models`, input.apiKey, input.signal);
  if (response.status >= 300 && response.status < 400) throw new ProviderRequestError("unavailable", response.status);
  if (!response.ok) throw mapProviderFailure(response.status, null);
  const parsed = await response.json() as { data?: { id?: unknown }[] };
  const ids = (parsed.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string" && id.trim().length > 0 && id.length <= 128);
  return [...new Set(ids)];
}

export async function testProviderConnection(input: Input & { model: string }): Promise<{ ok: true }> {
  const response = await request(`${input.baseUrl}/chat/completions`, input.apiKey, input.signal, {
    model: input.model,
    messages: [{ role: "user", content: "ping" }],
    stream: false,
    max_tokens: 1,
  });
  if (response.status >= 300 && response.status < 400) throw new ProviderRequestError("unavailable", response.status);
  if (!response.ok) throw mapProviderFailure(response.status, null);
  return { ok: true };
}
