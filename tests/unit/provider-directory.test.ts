import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderModels, testProviderConnection } from "../../lib/ai/provider-directory";
import { ProviderRequestError } from "../../lib/ai/provider-error";

describe("provider directory", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads model ids and ignores entries without an id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }, { id: "" }, { object: "model" }] }), { status: 200 })));
    await expect(listProviderModels({ baseUrl: "https://router.nibie.app/v1", apiKey: "k", signal: new AbortController().signal })).resolves.toEqual(["deepseek-chat"]);
  });

  it("connection test posts one token and maps 429", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(testProviderConnection({ baseUrl: "https://router.nibie.app/v1", apiKey: "k", model: "deepseek-chat", signal: new AbortController().signal })).rejects.toBeInstanceOf(ProviderRequestError);
    const body = JSON.parse((fetchMock.mock.calls as unknown as [unknown, { body: string }][])[0][1].body);
    expect(body).toMatchObject({ model: "deepseek-chat", stream: false, max_tokens: 1 });
  });
});
