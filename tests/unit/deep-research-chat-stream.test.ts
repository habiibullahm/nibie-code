import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderMessage } from "@/lib/ai/provider";
import type { WebContextInput } from "@/lib/web/types";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), research: vi.fn(), persistSources: vi.fn(), persistResearch: vi.fn(), capabilities: { contextWindowTokens: 16_384, maxOutputTokens: 2_048 } }));
vi.mock("@/lib/ai/provider", () => ({ chatProvider: { stream: mocks.stream }, configuredModelLabel: () => "test" }));
vi.mock("@/lib/ai/registry", () => ({
  contextCapabilitiesFor: () => mocks.capabilities,
  providerFor: () => "openai",
}));
vi.mock("@/lib/research/orchestrator", () => ({ runDeepResearch: mocks.research }));
vi.mock("@/lib/context/build-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/context/build-context")>();
  return { ...original, buildContext: vi.fn(original.buildContext) };
});
vi.mock("@/lib/web/provider", () => ({ getWebSearchProvider: () => null }));
vi.mock("@/lib/research/persist", () => ({ persistMessageResearch: mocks.persistResearch }));
vi.mock("@/lib/citations/persist", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/citations/persist")>(),
  persistMessageSources: mocks.persistSources,
}));
vi.mock("@/lib/context/thread-summary-store", () => ({
  deferThreadSummaryMaintenance: () => ({ complete: vi.fn(), finish: vi.fn() }),
}));
vi.mock("@/lib/usage/guards", () => ({
  reserveUsageBeforeGeneration: vi.fn(),
  startWeeklyUsage: async () => true,
  releaseUsageHold: vi.fn(),
  releaseWeeklyUsageHold: vi.fn(),
  finalizeGenerationSpend: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/usage/telemetry", () => ({ failureCategoryFrom: vi.fn(), logGenerationTelemetry: vi.fn() }));

import { createDeepResearchChatResponse } from "@/lib/research/chat-stream";
import { defaultUserPreferences } from "@/lib/preferences/types";
import { buildContext } from "@/lib/context/build-context";
import { estimateTokens } from "@/lib/context/token-budget";

describe("Deep Research synthesis citation grounding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistSources.mockResolvedValue({ ok: true });
    mocks.stream.mockImplementation(async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Evidence [SOURCE:web:1]." } }] })}\n\ndata: [DONE]\n\n`,
        ));
        controller.close();
      },
    }));
  });

  it.each([
    [16_384, 10, "complete"],
    [5_000, 10, "complete"],
    [2_800, 10, "complete"],
    [16_384, 1, "incomplete"],
  ] as const)("counts policy and preserves research status within %i tokens with %i sources and %s collection", async (contextWindowTokens, sourceCount, researchStatus) => {
    mocks.capabilities.contextWindowTokens = contextWindowTokens;
    const web: WebContextInput[] = Array.from({ length: sourceCount }, (_, index) => ({
      url: `https://source${index}.example/evidence`,
      domain: `source${index}.example`,
      title: `Evidence ${index}`,
      retrieval: "web_search",
      text: "Research evidence. ".repeat(100).slice(0, 1_800),
    }));
    mocks.research.mockResolvedValue({
      status: researchStatus,
      plan: { normalizedQuestion: "Research evidence", subquestions: [], initialQueries: ["evidence"], timeSensitive: false, notes: "" },
      web,
      evidence: web,
      contradictions: [],
      incompleteNotice: null,
      metrics: { modelCallCount: 1, searchQueryCount: 1, searchResultCount: 10, pagesFetched: 10, pagesFailed: 0, candidateUrlCount: 10, evidenceCount: 10, followUpUsed: false, durationMs: 1, timeSensitive: false },
    });
    const query = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: { id: "assistant", status: "streaming" }, error: null }),
    };
    const supabase = { from: () => query } as unknown as SupabaseClient;
    const response = await createDeepResearchChatResponse({
      request: new Request("http://localhost/api/chat"),
      requestId: "test-request",
      requestStartedAt: Date.now(),
      supabase,
      userId: "user",
      conversationId: "conversation",
      assistant: { id: "assistant", position: 2 },
      userMessage: { id: "user-message", content: "Research evidence", position: 1 },
      mode: "Fast",
      availablePlanMode: "Fast",
      preferences: defaultUserPreferences(),
      preferenceReadFailed: false,
      summary: null,
      room: null,
      files: undefined,
      attachments: [],
      memories: undefined,
      recallOperation: "none",
      rows: [{ role: "user", content: "Research evidence", position: 1 }],
      weeklyUsageReserved: true,
    });
    const events = await response.text();
    expect(events).toContain("event: done");
    expect(events).not.toContain("event: error");
    expect(mocks.stream).toHaveBeenCalledOnce();
    const prompt = mocks.stream.mock.calls[0]![1] as ProviderMessage[];
    const evidencePrompt = prompt.slice(1).map((message) => message.content).join("\n");
    const included = [...evidencePrompt.matchAll(/cite_as: \[SOURCE:(web:\d+)\]/g)].map((match) => match[1]);
    if (sourceCount > 1) {
      expect(included.length).toBeLessThan(web.length);
      expect(prompt[0]!.content).toContain("synthesis context");
    } else {
      expect(included).toHaveLength(1);
    }
    if (contextWindowTokens === 2_800) expect(included).toHaveLength(0);
    const allowed = [...prompt[0]!.content.matchAll(/\[SOURCE:(web:\d+)\] —/g)].map((match) => match[1]);
    expect(allowed).toEqual(included);
    if (included.length) {
      expect(mocks.persistSources.mock.calls[0]![0].sources.map((source: { id: string }) => source.id)).toEqual(included);
    } else {
      expect(prompt[0]!.content).toContain("No verified web sources");
      expect(mocks.persistSources).not.toHaveBeenCalled();
      expect(events).not.toContain("[1]");
    }
    expect(events).not.toContain("[SOURCE:");
    expect(mocks.persistResearch).toHaveBeenCalledWith(expect.objectContaining({ status: "incomplete" }));
    const builds = vi.mocked(buildContext).mock.results;
    expect(builds.length).toBeLessThanOrEqual(web.length + 1);
    const finalPlan = builds.at(-1)!.value as ReturnType<typeof buildContext>;
    expect(finalPlan.blocks[0]!.text).toBe(prompt[0]!.content);
    expect(finalPlan.budget.estimatedTokens).toBeLessThanOrEqual(finalPlan.budget.inputBudgetTokens);
    expect(estimateTokens(prompt.map((message) => message.content).join("\n\n"))).toBeLessThanOrEqual(finalPlan.budget.inputBudgetTokens);
  });
});
