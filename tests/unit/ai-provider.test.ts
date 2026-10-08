import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { openAiCompatibleProvider } from "../../lib/ai/provider";

const messages = [{ role: "user" as const, content: "hello" }];
function configure() {
  vi.stubEnv("SUMOPOD_BASE_URL", "https://gateway.invalid/v1"); vi.stubEnv("SUMOPOD_API_KEY", "gateway-key");
  vi.stubEnv("AI_PROVIDER", ""); vi.stubEnv("AI_BASE_URL", ""); vi.stubEnv("AI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "openai-key"); vi.stubEnv("OPENAI_BASE_URL", ""); vi.stubEnv("OPENAI_HIGH_REASONING_EFFORT", ""); vi.stubEnv("OPENAI_BALANCED_REASONING_EFFORT", "");
  vi.stubEnv("SUMOPOD_MODEL_FAST", ""); vi.stubEnv("OPENAI_MODEL_BALANCED", ""); vi.stubEnv("OPENAI_MODEL_HIGH", "");
}
function stubFetch() {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const fetchMock = vi.fn(async () => new Response(body, { status: 200 })); vi.stubGlobal("fetch", fetchMock);
  const sent = (call: number) => {
    const [url, init] = fetchMock.mock.calls[call] as unknown as [string, { headers: Record<string, string>; body: string }];
    return { url, authorization: init.headers.authorization, body: JSON.parse(init.body) };
  };
  return { body, fetchMock, sent };
}

describe("provider adapter routes each mode server-side", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("Fast calls the gateway with DeepSeek V4.1 Flash and an explicit output ceiling so hidden reasoning cannot use it all", async () => {
    configure(); const { body, sent } = stubFetch();
    expect(await openAiCompatibleProvider.stream("Fast", messages, new AbortController().signal)).toBe(body);
    expect(sent(0)).toEqual({ url: "https://gateway.invalid/v1/chat/completions", authorization: "Bearer gateway-key", body: { model: "deepseek-v4.1-flash:netra", messages, stream: true, stream_options: { include_usage: true }, max_tokens: 8192 } });
  });

  it("Balanced calls OpenAI with GPT-6 Luna and sends no reasoning parameter", async () => {
    configure(); const { sent } = stubFetch();
    await openAiCompatibleProvider.stream("Balanced", messages, new AbortController().signal);
    expect(sent(0)).toEqual({ url: "https://api.openai.com/v1/chat/completions", authorization: "Bearer openai-key", body: { model: "gpt-6-luna", messages, stream: true, stream_options: { include_usage: true } } });
  });

  it("High calls OpenAI with GPT-6.1 Sol and always sends reasoning_effort high", async () => {
    configure(); const { sent } = stubFetch();
    await openAiCompatibleProvider.stream("High", messages, new AbortController().signal);
    expect(sent(0)).toEqual({ url: "https://api.openai.com/v1/chat/completions", authorization: "Bearer openai-key", body: { model: "gpt-6.1-sol", messages, stream: true, stream_options: { include_usage: true }, reasoning_effort: "high" } });
  });

  it("Balanced sends medium when the server configures it, High keeps its own setting, and Fast never sends one", async () => {
    configure(); const { sent } = stubFetch();
    vi.stubEnv("OPENAI_BALANCED_REASONING_EFFORT", "medium"); vi.stubEnv("OPENAI_HIGH_REASONING_EFFORT", "high");
    for (const mode of ["Balanced", "High", "Fast"] as const) await openAiCompatibleProvider.stream(mode, messages, new AbortController().signal);
    expect(sent(0).body).toEqual({ model: "gpt-6-luna", messages, stream: true, stream_options: { include_usage: true }, reasoning_effort: "medium" });
    expect(sent(1).body).toEqual({ model: "gpt-6.1-sol", messages, stream: true, stream_options: { include_usage: true }, reasoning_effort: "high" });
    expect(sent(2).body).not.toHaveProperty("reasoning_effort");
    // The output ceiling belongs to the Sumopod request only; OpenAI reasoning models use a different parameter and are left alone.
    expect(sent(0).body).not.toHaveProperty("max_tokens");
    expect(sent(1).body).not.toHaveProperty("max_tokens");
    expect(sent(2).body.max_tokens).toBe(8192);
  });

  it("never sends the gateway key to OpenAI or the OpenAI key to the gateway", async () => {
    configure(); const { fetchMock, sent } = stubFetch();
    for (const mode of ["Fast", "Balanced", "High"] as const) await openAiCompatibleProvider.stream(mode, messages, new AbortController().signal);
    expect([0, 1, 2].map((call) => [new URL(sent(call).url).host, sent(call).authorization])).toEqual([
      ["gateway.invalid", "Bearer gateway-key"], ["api.openai.com", "Bearer openai-key"], ["api.openai.com", "Bearer openai-key"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails without calling any provider when the requested mode has no configured provider", async () => {
    configure(); vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(openAiCompatibleProvider.stream("Balanced", messages, new AbortController().signal)).rejects.toThrow("Unavailable model mode: Balanced");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides provider failures behind a generic error", async () => {
    configure(); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket detail with secret"); }));
    await expect(openAiCompatibleProvider.stream("Fast", messages, new AbortController().signal)).rejects.toThrow("AI provider request failed.");
  });

  it("Fast still reaches Sumopod when the OpenAI configuration is broken, while Balanced and High fail closed without any request", async () => {
    configure(); const { fetchMock, sent } = stubFetch();
    vi.stubEnv("OPENAI_BASE_URL", "http://not-https.example"); vi.stubEnv("OPENAI_BALANCED_REASONING_EFFORT", "nonsense"); vi.stubEnv("OPENAI_HIGH_REASONING_EFFORT", "nonsense");
    await openAiCompatibleProvider.stream("Fast", messages, new AbortController().signal);
    expect(sent(0)).toEqual({ url: "https://gateway.invalid/v1/chat/completions", authorization: "Bearer gateway-key", body: { model: "deepseek-v4.1-flash:netra", messages, stream: true, stream_options: { include_usage: true }, max_tokens: 8192 } });
    for (const mode of ["Balanced", "High"] as const) await expect(openAiCompatibleProvider.stream(mode, messages, new AbortController().signal)).rejects.toThrow(`Unavailable model mode: ${mode}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Balanced and High still reach OpenAI when the Sumopod configuration is broken", async () => {
    configure(); const { sent } = stubFetch();
    vi.stubEnv("SUMOPOD_BASE_URL", "not a url");
    await expect(openAiCompatibleProvider.stream("Fast", messages, new AbortController().signal)).rejects.toThrow("Unavailable model mode: Fast");
    await openAiCompatibleProvider.stream("Balanced", messages, new AbortController().signal);
    await openAiCompatibleProvider.stream("High", messages, new AbortController().signal);
    expect([0, 1].map((call) => sent(call).body.model)).toEqual(["gpt-6-luna", "gpt-6.1-sol"]);
  });
});
