import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getAiConfig, getModelOptions, providerFor, resolveRoute } from "../../lib/ai/registry";
import { resolveMode } from "../../lib/chat/models";

const gateway = { SUMOPOD_BASE_URL: "https://gateway.example/v1/", SUMOPOD_API_KEY: "gateway-secret" };
const openai = { OPENAI_API_KEY: "openai-secret" };
const all = { ...gateway, ...openai };

describe("authoritative server routing registry", () => {
  it("routes Fast to DeepSeek V4.1 Flash on the Sumopod gateway", () => {
    const route = resolveRoute("Fast", getAiConfig(all));
    expect(route).toEqual({ provider: "sumopod", baseUrl: "https://gateway.example/v1", apiKey: "gateway-secret", model: "deepseek-v4.1-flash:netra", maxOutputTokens: 8192 });
  });

  it("routes Balanced to GPT-6 Luna with the provider default effort, and High to GPT-6.1 Sol with reasoning_effort high", () => {
    const config = getAiConfig(all);
    expect(resolveRoute("Balanced", config)).toEqual({ provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "openai-secret", model: "gpt-6-luna" });
    expect(resolveRoute("High", config)).toEqual({ provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "openai-secret", model: "gpt-6.1-sol", reasoningEffort: "high" });
  });

  it("keeps serving Fast from the earlier AI_* gateway names, and prefers SUMOPOD_* when both are set", () => {
    const legacy = { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://old.example/v1", AI_API_KEY: "old-secret", AI_MODEL_FAST: "minimax-must-be-ignored" };
    expect(resolveRoute("Fast", getAiConfig(legacy))).toEqual({ provider: "sumopod", baseUrl: "https://old.example/v1", apiKey: "old-secret", model: "deepseek-v4.1-flash:netra", maxOutputTokens: 8192 });
    expect(resolveRoute("Fast", getAiConfig({ ...legacy, ...gateway })).apiKey).toBe("gateway-secret");
  });

  it("lets the server override model ids and the OpenAI base URL without touching the client", () => {
    const config = getAiConfig({ ...all, SUMOPOD_MODEL_FAST: "fast-x", OPENAI_MODEL_BALANCED: "balanced-x", OPENAI_MODEL_HIGH: "high-x", OPENAI_BASE_URL: "https://proxy.example/v1/" });
    expect(["Fast", "Balanced", "High"].map((mode) => resolveRoute(mode as "Fast", config).model)).toEqual(["fast-x", "balanced-x", "high-x"]);
    expect(resolveRoute("Balanced", config).baseUrl).toBe("https://proxy.example/v1");
  });

  it("rejects an OPENAI_BASE_URL that is not a valid HTTPS URL", () => {
    expect(() => getAiConfig({ ...openai, OPENAI_BASE_URL: "http://plain.example/v1" })).toThrow("HTTPS");
    expect(() => getAiConfig({ ...openai, OPENAI_BASE_URL: "not a url" })).toThrow("valid URL");
  });

  it("High always carries a reasoning effort (high by default, never dropped)", () => {
    expect(resolveRoute("High", getAiConfig(all)).reasoningEffort).toBe("high");
    expect(resolveRoute("High", getAiConfig({ ...all, OPENAI_HIGH_REASONING_EFFORT: "HIGH" })).reasoningEffort).toBe("high");
    expect(resolveRoute("High", getAiConfig({ ...all, OPENAI_HIGH_REASONING_EFFORT: "medium" })).reasoningEffort).toBe("medium");
    expect(resolveRoute("High", getAiConfig({ ...all, OPENAI_HIGH_REASONING_EFFORT: "  " })).reasoningEffort).toBe("high");
    for (const mode of ["Fast", "Balanced"] as const) expect(resolveRoute(mode, getAiConfig({ ...all, OPENAI_HIGH_REASONING_EFFORT: "high" }))).not.toHaveProperty("reasoningEffort");
  });

  it("Balanced sends an effort only when OPENAI_BALANCED_REASONING_EFFORT is set to a recognised value, and Fast never does", () => {
    expect(resolveRoute("Balanced", getAiConfig(all))).not.toHaveProperty("reasoningEffort");
    expect(resolveRoute("Balanced", getAiConfig({ ...all, OPENAI_BALANCED_REASONING_EFFORT: "medium" })).reasoningEffort).toBe("medium");
    expect(resolveRoute("Balanced", getAiConfig({ ...all, OPENAI_BALANCED_REASONING_EFFORT: " LOW " })).reasoningEffort).toBe("low");
    expect(resolveRoute("High", getAiConfig({ ...all, OPENAI_BALANCED_REASONING_EFFORT: "low" })).reasoningEffort).toBe("high");
    expect(resolveRoute("Fast", getAiConfig({ ...all, OPENAI_BALANCED_REASONING_EFFORT: "medium", OPENAI_HIGH_REASONING_EFFORT: "high" }))).not.toHaveProperty("reasoningEffort");
  });

  it("a bad variable removes only the routes that depend on it, and the issue names the variable but never the value", () => {
    const cases: [string, Record<string, string>, string[], string][] = [
      ["bad Balanced effort", { OPENAI_BALANCED_REASONING_EFFORT: "super-secret-typo" }, ["Fast", "High"], "OPENAI_BALANCED_REASONING_EFFORT must be low, medium or high."],
      ["bad High effort", { OPENAI_HIGH_REASONING_EFFORT: "super-secret-typo" }, ["Fast", "Balanced"], "OPENAI_HIGH_REASONING_EFFORT must be low, medium or high."],
      ["bad OpenAI base URL", { OPENAI_BASE_URL: "http://super-secret-typo.example" }, ["Fast"], "OPENAI_BASE_URL must use HTTPS."],
      ["unparseable OpenAI base URL", { OPENAI_BASE_URL: "super secret typo" }, ["Fast"], "OPENAI_BASE_URL must be a valid URL."],
      ["bad Sumopod base URL", { SUMOPOD_BASE_URL: "super secret typo" }, ["Balanced", "High"], "SUMOPOD_BASE_URL must be a valid URL."],
      ["unsupported legacy gateway type", { AI_PROVIDER: "super-secret-typo" }, ["Balanced", "High"], "Unsupported AI_PROVIDER; expected openai-compatible."],
    ];
    for (const [label, broken, surviving, issue] of cases) {
      const config = getAiConfig({ ...all, ...broken });
      expect(Object.keys(config.routes), label).toEqual(surviving);
      expect(config.issues, label).toEqual([issue]);
      expect(JSON.stringify(config.issues), label).not.toContain("super");
      expect(getModelOptions({ ...all, ...broken }).models.map((model) => model.id), label).toEqual(surviving);
    }
  });

  it("a broken OpenAI variable can never disable Fast, and a broken Sumopod variable can never disable Balanced or High", () => {
    const brokenOpenAi = { OPENAI_BASE_URL: "http://nope.example", OPENAI_BALANCED_REASONING_EFFORT: "nope", OPENAI_HIGH_REASONING_EFFORT: "nope" };
    expect(Object.keys(getAiConfig({ ...all, ...brokenOpenAi }).routes)).toEqual(["Fast"]);
    expect(resolveRoute("Fast", getAiConfig({ ...all, ...brokenOpenAi })).model).toBe("deepseek-v4.1-flash:netra");
    const brokenSumopod = { SUMOPOD_BASE_URL: "not a url", AI_PROVIDER: "nope" };
    expect(Object.keys(getAiConfig({ ...all, ...brokenSumopod }).routes)).toEqual(["Balanced", "High"]);
    expect(resolveRoute("High", getAiConfig({ ...all, ...brokenSumopod })).reasoningEffort).toBe("high");
  });

  it("logs each broken route by variable name only, and still offers the routes that work", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(getModelOptions({ ...all, OPENAI_BALANCED_REASONING_EFFORT: "super-secret-typo" }).models.map((model) => model.id)).toEqual(["Fast", "High"]);
      const lines = logged.mock.calls.map((call) => String(call[0])).join("\n");
      expect(lines).toContain("ai.config.invalid");
      expect(lines).toContain("OPENAI_BALANCED_REASONING_EFFORT must be low, medium or high.");
      expect(lines).not.toContain("super-secret-typo");
      logged.mockClear();
      getModelOptions({});
      expect(logged).not.toHaveBeenCalled();
    } finally { logged.mockRestore(); }
  });

  it("when no route is usable at all, says why by variable name and offers nothing", () => {
    expect(() => getAiConfig({ ...openai, OPENAI_BASE_URL: "http://nope.example", OPENAI_HIGH_REASONING_EFFORT: "nope" })).toThrow("OPENAI_BASE_URL must use HTTPS.");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(getModelOptions({ ...openai, OPENAI_BASE_URL: "http://nope.example" })).toEqual({ models: [] }); } finally { logged.mockRestore(); }
  });

  it("reports which provider serves a mode, for logs only", () => {
    expect(["Fast", "Balanced", "High"].map((mode) => providerFor(mode as "Fast", all))).toEqual(["sumopod", "openai", "openai"]);
    expect(providerFor("Balanced", gateway)).toBeNull();
    expect(providerFor("Fast", {})).toBeNull();
  });

  it("offers only the modes whose provider is configured and refuses to resolve the rest", () => {
    const fastOnly = getAiConfig(gateway);
    expect(Object.keys(fastOnly.routes)).toEqual(["Fast"]);
    expect(() => resolveRoute("Balanced", fastOnly)).toThrow("Unavailable model mode: Balanced");
    const openAiOnly = getAiConfig({ OPENAI_API_KEY: "k", SUMOPOD_API_KEY: "  " });
    expect(Object.keys(openAiOnly.routes)).toEqual(["Balanced", "High"]);
  });

  it("reports what is missing without printing any value, and rejects an unsupported gateway type", () => {
    expect(() => getAiConfig({})).toThrow("SUMOPOD_API_KEY");
    expect(() => getAiConfig({ AI_PROVIDER: "other", AI_BASE_URL: "x", AI_API_KEY: "y" })).toThrow("Unsupported AI_PROVIDER");
  });
});

describe("model options offered to the UI", () => {
  it("is one picker: Fast, Balanced, High with product copy, in product order", () => {
    expect(getModelOptions(all).models).toEqual([
      { id: "Fast", label: "Fast", description: "Quick answers" },
      { id: "Balanced", label: "Balanced", description: "Best for everyday work" },
      { id: "High", label: "High", description: "Deeper reasoning" },
    ]);
  });

  it("never includes keys, URLs, provider names, model ids or reasoning effort", () => {
    const serialized = JSON.stringify(getModelOptions({ ...all, OPENAI_HIGH_REASONING_EFFORT: "high" }));
    for (const secret of ["gateway-secret", "openai-secret", "gateway.example", "api.openai.com", "openai-compatible", "deepseek", "gpt-6", "luna", "sol", "netra", "reasoning_effort", "OPENAI", "sumopod", "effort"]) {
      expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(serialized).not.toContain("Reasoning");
  });

  it("does not throw when nothing is configured", () => {
    expect(getModelOptions({})).toEqual({ models: [] });
  });
});

describe("mode resolution on the client side of the contract", () => {
  it("keeps an available saved mode and otherwise falls back to Balanced, Fast, High", () => {
    expect(resolveMode("Fast", ["Fast", "Balanced"])).toBe("Fast");
    expect(resolveMode("High", ["Fast", "Balanced", "High"])).toBe("High");
    expect(resolveMode("High", ["Fast", "Balanced"])).toBe("Balanced");
    expect(resolveMode("default", ["Fast", "High"])).toBe("Fast");
    expect(resolveMode(undefined, ["High"])).toBe("High");
    expect(resolveMode("Fast", [])).toBeNull();
  });

  it("is strict: the client never interprets the legacy Reasoning id", () => {
    expect(resolveMode("Reasoning", ["Fast", "Balanced", "High"])).toBe("Balanced");
  });
});
