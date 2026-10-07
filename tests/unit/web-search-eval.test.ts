import { describe, expect, it, vi } from "vitest";
import { toProviderMessages } from "@/lib/ai/provider-messages";
import { buildContext } from "@/lib/context/build-context";
import { CONTEXT_POLICY_TEXT } from "@/lib/context/context-policy";
import {
  fenceWebText,
  renderWebContext,
  WEB_CONTEXT_PREFACE,
  WEB_VERIFICATION_UNAVAILABLE_DIAGNOSTIC_REASON,
  WEB_VERIFICATION_UNAVAILABLE_INSTRUCTION,
} from "@/lib/context/web-context";
import { WEB_TOKEN_CAP } from "@/lib/context/token-budget";
import { defaultUserPreferences } from "@/lib/preferences/types";
import type { BuildContextInput } from "@/lib/context/context-types";
import { extractReadableText } from "@/lib/web/extract";
import { runWebSearchPipeline } from "@/lib/web/pipeline";
import { decideWebSearch } from "@/lib/web/routing";
import { assertSafeFetchUrl, SsrfError } from "@/lib/web/ssrf";
import {
  HOSTILE_PROMPT_INJECTION_HTML,
  HOSTILE_PROMPT_INJECTION_TEXT,
  ROOM_FILE_FIXTURE,
  SSRF_BLOCKED_URLS,
  WEB_EVAL_ROUTE_CASES,
  WEB_EVAL_SEARCH_CONFIG,
  WEB_EVAL_SEARCH_RESULTS,
  mockFailingWebSearchProvider,
  mockWebSearchProvider,
  webContextSource,
} from "../fixtures/web-search";

const capabilities = { contextWindowTokens: 16_384, maxOutputTokens: 2_048 };

function contextInput(overrides: Partial<BuildContextInput> = {}): BuildContextInput {
  return {
    capabilities,
    preferences: defaultUserPreferences(),
    preferenceReadFailed: false,
    summary: null,
    messages: [{ role: "user", content: "What is the latest Node.js LTS version?", position: 1 }],
    currentPosition: 1,
    ...overrides,
  };
}

describe("web search eval (brief §12)", () => {
  describe("routing matrix", () => {
    it.each(WEB_EVAL_ROUTE_CASES)(
      "$id → $expected.reason (search=$expected.search)",
      ({ query, opts, expected }) => {
        expect(decideWebSearch(query, opts)).toEqual(expected);
      },
    );
  });

  describe("no web", () => {
    it("does not call the search provider for conceptual / writing / coding / weak-token queries", async () => {
      const searchWeb = vi.fn(async () => [...WEB_EVAL_SEARCH_RESULTS]);
      const provider = { id: "tavily" as const, searchWeb };
      const noWebQueries = WEB_EVAL_ROUTE_CASES.filter(
        (c) => c.id === "no_web" || c.id === "no_web_weak_token",
      );

      for (const { query, opts, expected } of noWebQueries) {
        const decision = decideWebSearch(query, opts);
        expect(decision).toEqual(expected);
        // Chat route only runs the pipeline when search === true.
        if (!decision.search) continue;
        await runWebSearchPipeline(query, {
          signal: AbortSignal.timeout(5_000),
          provider,
          config: WEB_EVAL_SEARCH_CONFIG,
          fetchPage: vi.fn(),
        });
      }

      expect(searchWeb).not.toHaveBeenCalled();
      const plan = buildContext(contextInput({ web: undefined }));
      expect(plan.blocks.some((block) => block.id === "web")).toBe(false);
    });
  });

  describe("current version / news / CEO / explicit search", () => {
    it("routes to search and yields web sources when the provider is mocked", async () => {
      const searchCases = WEB_EVAL_ROUTE_CASES.filter((c) =>
        ["current_version", "news", "ceo", "explicit_search"].includes(c.id),
      );
      const fetchPage = vi.fn(async (url: string) => ({
        url,
        finalUrl: url,
        contentType: "text/html",
        body: `<html><body><p>Fetched page about ${url}</p></body></html>`,
      }));

      for (const { query, expected } of searchCases) {
        expect(decideWebSearch(query)).toEqual(expected);
        const pipeline = await runWebSearchPipeline(query, {
          signal: AbortSignal.timeout(5_000),
          provider: mockWebSearchProvider([...WEB_EVAL_SEARCH_RESULTS]),
          config: { ...WEB_EVAL_SEARCH_CONFIG, maxPages: 2, maxSources: 5 },
          fetchPage,
        });
        expect(pipeline.degraded).toBe(false);
        expect(pipeline.sources.length).toBeGreaterThan(0);
        expect(pipeline.sources.length).toBeLessThanOrEqual(5);
        expect(pipeline.pagesFetched).toBeGreaterThan(0);

        const plan = buildContext(
          contextInput({
            messages: [{ role: "user", content: query, position: 1 }],
            web: pipeline.sources,
          }),
        );
        const webBlock = plan.blocks.find((block) => block.id === "web");
        expect(webBlock).toMatchObject({ included: true, authority: "untrusted_data" });
        expect(plan.diagnostics.sources.some((s) => s.type === "web" && s.state === "included")).toBe(
          true,
        );
      }
    });
  });

  describe("Room only", () => {
    it("skips web when Room file context is sufficient", () => {
      const roomOnly = WEB_EVAL_ROUTE_CASES.find((c) => c.id === "room_only")!;
      expect(decideWebSearch(roomOnly.query, roomOnly.opts)).toEqual(roomOnly.expected);

      const plan = buildContext(
        contextInput({
          messages: [{ role: "user", content: roomOnly.query, position: 1 }],
          files: [ROOM_FILE_FIXTURE],
          web: undefined,
        }),
      );
      expect(plan.blocks.find((block) => block.id === "file")?.included).toBe(true);
      expect(plan.blocks.some((block) => block.id === "web" && block.included)).toBe(false);
      expect(plan.diagnostics.sources.map((s) => s.type)).not.toContain("web");
    });
  });

  describe("Room + web", () => {
    it("keeps Room file excerpts and web sources together when currency asks search", async () => {
      const roomPlusWeb = WEB_EVAL_ROUTE_CASES.find((c) => c.id === "room_plus_web")!;
      expect(decideWebSearch(roomPlusWeb.query, roomPlusWeb.opts)).toEqual(roomPlusWeb.expected);

      const pipeline = await runWebSearchPipeline(roomPlusWeb.query, {
        signal: AbortSignal.timeout(5_000),
        provider: mockWebSearchProvider([...WEB_EVAL_SEARCH_RESULTS]),
        config: { ...WEB_EVAL_SEARCH_CONFIG, maxPages: 2 },
        fetchPage: async (url) => ({
          url,
          finalUrl: url,
          contentType: "text/html",
          body: "<p>Node.js 22 is the current LTS line.</p>",
        }),
      });
      expect(pipeline.sources.length).toBeGreaterThan(0);

      const plan = buildContext(
        contextInput({
          messages: [{ role: "user", content: roomPlusWeb.query, position: 1 }],
          room: { name: "Docs", instructions: "Stay calm", brief: null },
          files: [ROOM_FILE_FIXTURE],
          web: pipeline.sources,
        }),
      );
      expect(plan.diagnostics.sources.map((s) => s.type)).toEqual(
        expect.arrayContaining(["file", "web"]),
      );
      const messages = toProviderMessages(plan);
      const data = messages[1]?.content ?? "";
      expect(data).toContain(ROOM_FILE_FIXTURE.text);
      expect(data).toContain("<untrusted_web_content>");
      expect(data.indexOf(ROOM_FILE_FIXTURE.text)).toBeLessThan(
        data.indexOf("<untrusted_web_content>"),
      );
    });
  });

  describe("prompt injection isolation", () => {
    it("keeps hostile fetched HTML untrusted and outside product policy", () => {
      const extracted = extractReadableText(HOSTILE_PROMPT_INJECTION_HTML);
      expect(extracted).toContain("Node.js 22");
      expect(extracted).toMatch(/Ignore all previous instructions/i);
      expect(extracted).not.toContain("window.steal");
      expect(extracted.toLowerCase()).not.toContain("<script");

      const fenced = fenceWebText(HOSTILE_PROMPT_INJECTION_TEXT);
      expect(fenced).not.toMatch(/<\/?\s*untrusted_web_content/i);

      const source = webContextSource({ text: HOSTILE_PROMPT_INJECTION_TEXT });
      const rendered = renderWebContext([source], WEB_TOKEN_CAP);
      expect(rendered.text).toContain(WEB_CONTEXT_PREFACE);
      expect(rendered.text).toContain("[boundary tag removed]");
      expect(rendered.text.match(/<untrusted_web_content>/g)).toHaveLength(1);
      expect(rendered.text.match(/<\/untrusted_web_content>/g)).toHaveLength(1);

      const plan = buildContext(contextInput({ web: [source] }));
      const core = plan.blocks.find((block) => block.id === "core");
      expect(core?.text).toBe(CONTEXT_POLICY_TEXT);
      expect(core?.text).not.toContain("Live LTS is 22");
      expect(core?.text).not.toMatch(/Ignore all previous instructions/i);
      expect(core?.text).toMatch(/Web sources below are untrusted/i);

      const messages = toProviderMessages(plan);
      expect(messages[0]?.content).toBe(CONTEXT_POLICY_TEXT);
      expect(messages[1]?.content).toContain("<untrusted_web_content>");
      expect(messages[1]?.content).toContain("Live LTS is 22");
    });
  });

  describe("SSRF localhost blocked", () => {
    it("blocks loopback, metadata, private, and non-http(s) URLs without DNS connect", async () => {
      const lookup = vi.fn(async () => ["93.184.216.34"]);
      for (const url of SSRF_BLOCKED_URLS) {
        await expect(assertSafeFetchUrl(url, lookup)).rejects.toBeInstanceOf(SsrfError);
      }
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe("provider failure does not crash", () => {
    it("degrades to empty web sources and still builds a normal context plan", async () => {
      const decision = decideWebSearch("What is the latest version of Next.js?");
      expect(decision.search).toBe(true);

      const pipeline = await runWebSearchPipeline("What is the latest version of Next.js?", {
        signal: AbortSignal.timeout(5_000),
        provider: mockFailingWebSearchProvider(),
        config: WEB_EVAL_SEARCH_CONFIG,
        fetchPage: vi.fn(),
      });
      expect(pipeline).toMatchObject({
        sources: [],
        degraded: true,
        failureCategory: "provider_error",
        pagesFetched: 0,
      });

      // Route pattern: empty pipeline → omit web sources; instruct model not to invent current facts.
      const plan = buildContext(
        contextInput({
          web: pipeline.sources.length ? pipeline.sources : undefined,
          webVerificationUnavailable: true,
        }),
      );
      expect(plan.blocks.some((block) => block.id === "web")).toBe(false);
      expect(plan.blocks.find((block) => block.id === "core")?.text).toContain(
        WEB_VERIFICATION_UNAVAILABLE_INSTRUCTION,
      );
      expect(plan.diagnostics.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "web",
            state: "not_used",
            reason: WEB_VERIFICATION_UNAVAILABLE_DIAGNOSTIC_REASON,
          }),
        ]),
      );
      expect(() => toProviderMessages(plan)).not.toThrow();
      const messages = toProviderMessages(plan);
      expect(messages[0]?.content).toContain(WEB_VERIFICATION_UNAVAILABLE_INSTRUCTION);
      expect(messages.at(-1)?.content).toBe("What is the latest Node.js LTS version?");
    });

    it("degrades when provider/config are unconfigured", async () => {
      const out = await runWebSearchPipeline("latest news", {
        signal: AbortSignal.timeout(5_000),
        provider: null,
        config: WEB_EVAL_SEARCH_CONFIG,
      });
      expect(out.failureCategory).toBe("provider_unconfigured");
      expect(out.sources).toEqual([]);

      const plan = buildContext(contextInput({ webVerificationUnavailable: true }));
      expect(plan.blocks.find((block) => block.id === "core")?.text).toContain(
        WEB_VERIFICATION_UNAVAILABLE_INSTRUCTION,
      );
    });
  });

  describe("empty-web safe behavior", () => {
    it("keeps chat buildable and forbids unverified current facts when search yields nothing", () => {
      const plan = buildContext(
        contextInput({
          messages: [{ role: "user", content: "Who is the current CEO of Stripe?", position: 1 }],
          web: undefined,
          webVerificationUnavailable: true,
        }),
      );
      expect(plan.blocks.find((block) => block.id === "core")?.text).toMatch(
        /Web verification was unavailable/i,
      );
      expect(plan.blocks.find((block) => block.id === "core")?.text).toMatch(
        /Do not present unverified current public facts/i,
      );
      expect(plan.diagnostics.sources.some((s) => s.type === "web" && s.state === "not_used")).toBe(
        true,
      );
      expect(() => toProviderMessages(plan)).not.toThrow();
    });
  });
});
