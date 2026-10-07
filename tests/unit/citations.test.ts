import { describe, expect, it } from "vitest";
import { linkCitationMarkers } from "../../components/message-markdown";
import { attachWebCitationHandles } from "../../lib/citations/attach";
import { citationSourcesIncludedInContext } from "../../lib/citations/included";
import { createCitationStreamFilter, parseCitationReferences } from "../../lib/citations/parse";
import { persistMessageSources, loadMessageSourcesByConversation } from "../../lib/citations/persist";
import {
  citationInstructionFor,
  prepareWebSourceReferences,
  toCitationSourceViews,
} from "../../lib/citations/prepare";
import { sanitizeCitationTitle } from "../../lib/citations/sanitize";
import type { SourceReference } from "../../lib/citations/types";
import { renderWebContext } from "../../lib/context/web-context";
import { WEB_TOKEN_CAP } from "../../lib/context/token-budget";
import type { WebContextInput } from "../../lib/web/types";

const web = (overrides: Partial<WebContextInput> = {}): WebContextInput => ({
  url: "https://nodejs.org/en",
  title: "Node.js",
  domain: "nodejs.org",
  retrieval: "web_search",
  text: "Node.js 22 is current.",
  ...overrides,
});

describe("citations prepare", () => {
  it("builds one SourceReference with a deterministic web handle", () => {
    const sources = prepareWebSourceReferences([web()]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: "web:1",
      kind: "web",
      title: "Node.js",
      url: "https://nodejs.org/en",
      domain: "nodejs.org",
    });
    const attached = attachWebCitationHandles([web()]);
    expect(attached.web[0]?.citationHandle).toBe("web:1");
    const rendered = renderWebContext(attached.web, 1200);
    expect(rendered.text).toContain("cite_as: [SOURCE:web:1]");
  });

  it("assigns two handles for two sources", () => {
    const sources = prepareWebSourceReferences([
      web(),
      web({ url: "https://example.com/a", title: "Example", domain: "example.com", text: "Other" }),
    ]);
    expect(sources.map((s) => s.id)).toEqual(["web:1", "web:2"]);
  });

  it("sanitizes malicious markup in titles", () => {
    expect(sanitizeCitationTitle('<img src=x onerror=alert(1)>Evil</script>')).toBe("Evil");
    const sources = prepareWebSourceReferences([
      web({ title: '<a href="javascript:alert(1)">Click</a>' }),
    ]);
    expect(sources[0]?.title).not.toMatch(/<|>|javascript:/i);
    expect(sources[0]?.title).toContain("Click");
  });

  it("builds authoritative citation rules that forbid prose source lists", () => {
    const sources = prepareWebSourceReferences([web()]);
    const rules = citationInstructionFor(sources);
    expect(rules).toMatch(/Citation rules for this reply/);
    expect(rules).toContain("[SOURCE:web:1]");
    expect(rules).toMatch(/never with prose source lists/i);
    expect(rules).toMatch(/Sumber/i);
    expect(citationInstructionFor([])).toBe("");
  });
});

describe("citations parse", () => {
  const sources: SourceReference[] = prepareWebSourceReferences([
    web(),
    web({ url: "https://example.com/b", title: "B", domain: "example.com", text: "B text" }),
  ]);

  it("renders a single citation marker for one source", () => {
    const result = parseCitationReferences("Node 22 is current [SOURCE:web:1].", sources);
    expect(result.text).toBe("Node 22 is current [1].");
    expect(result.citationCount).toBe(1);
    expect(result.citedOrdinals).toEqual([1]);
    expect(result.invalidCitationCount).toBe(0);
  });

  it("renders both markers when a claim cites two sources", () => {
    const result = parseCitationReferences(
      "Supported by both [SOURCE:web:1][SOURCE:web:2].",
      sources,
    );
    expect(result.text).toBe("Supported by both [1][2].");
    expect(result.citedOrdinals).toEqual([1, 2]);
    expect(result.citationCount).toBe(2);
  });

  it("rejects unknown source IDs without inventing citations", () => {
    const result = parseCitationReferences(
      "Fake [SOURCE:web:9] and real [SOURCE:web:1].",
      sources,
    );
    expect(result.text).toBe("Fake  and real [1].");
    expect(result.invalidCitationCount).toBe(1);
    expect(result.citedOrdinals).toEqual([1]);
  });

  it("strips invented handles when no sources were prepared", () => {
    const result = parseCitationReferences("No web [SOURCE:web:1] here.", []);
    expect(result.text).not.toContain("[SOURCE:");
    expect(result.text).not.toContain("[1]");
    expect(result.citationCount).toBe(0);
    expect(result.invalidCitationCount).toBe(1);
  });

  it("stream filter transforms handles incrementally and holds partial markers", () => {
    const filter = createCitationStreamFilter(sources);
    expect(filter.push("Hello [SOURCE:we")).toBe("Hello ");
    expect(filter.push("b:1] world")).toBe("[1] world");
    expect(filter.finish()).toBe("");
    expect(filter.citationCount).toBe(1);
  });

  it("finish never leaves stuck [SOURCE: prefixes in output", () => {
    const filter = createCitationStreamFilter(sources);
    expect(filter.push("Lead [SOURCE:web:1")).toBe("Lead ");
    const rest = filter.finish();
    expect(rest).toBe("");
    expect(`${rest}`).not.toContain("[SOURCE:");
    expect(filter.invalidCitationCount).toBe(1);
    // A bare incomplete open is also dropped.
    const again = createCitationStreamFilter(sources);
    expect(again.push("[SOURCE:web:")).toBe("");
    expect(again.finish()).toBe("");
    expect(again.finish()).toBe("");
  });
});

describe("citations included-in-context allowlist", () => {
  it("rejects handles for sources omitted from the rendered web context", () => {
    const attached = attachWebCitationHandles([
      web({ text: "Node.js 22 is current." }),
      web({
        url: "https://example.com/omitted",
        title: "Omitted",
        domain: "example.com",
        text: "   ",
      }),
    ]);
    expect(attached.sources.map((source) => source.id)).toEqual(["web:1", "web:2"]);
    const rendered = renderWebContext(attached.web, WEB_TOKEN_CAP);
    expect(rendered.includedHandles).toEqual(["web:1"]);
    const included = citationSourcesIncludedInContext(attached.sources, rendered.includedHandles);
    expect(included.map((source) => source.id)).toEqual(["web:1"]);
    const parsed = parseCitationReferences(
      "Real [SOURCE:web:1] and omitted [SOURCE:web:2].",
      included,
    );
    expect(parsed.text).toBe("Real [1] and omitted .");
    expect(parsed.citedOrdinals).toEqual([1]);
    expect(parsed.invalidCitationCount).toBe(1);
    expect(toCitationSourceViews(included)).toHaveLength(1);
  });

  it("rejects a later source when the token budget only fits the first", () => {
    const attached = attachWebCitationHandles([
      web({ text: "first source body ".repeat(80) }),
      web({
        url: "https://example.com/second",
        title: "Second",
        domain: "example.com",
        text: "second source body ".repeat(80),
      }),
    ]);
    const rendered = renderWebContext(attached.web, 400);
    expect(rendered.includedHandles).toEqual(["web:1"]);
    expect(rendered.includedHandles).not.toContain("web:2");
    const included = citationSourcesIncludedInContext(attached.sources, rendered.includedHandles);
    const parsed = parseCitationReferences("Cite [SOURCE:web:2] only.", included);
    expect(parsed.text).not.toContain("[2]");
    expect(parsed.text).not.toContain("[SOURCE:");
    expect(parsed.invalidCitationCount).toBe(1);
  });
});

describe("citations UI markers", () => {
  it("links known markers and leaves unknown numbers alone", () => {
    const views = toCitationSourceViews(prepareWebSourceReferences([web()]));
    expect(linkCitationMarkers("See [1] and [2].", views)).toBe(
      "See [[1]](#citation-source-1) and [2].",
    );
  });

  it("does not turn raw URLs into a Sources dump when there are no sources", () => {
    expect(linkCitationMarkers("See https://evil.example for details.", [])).toBe(
      "See https://evil.example for details.",
    );
  });
});

describe("citations persistence", () => {
  it("stores sources with the assistant message so reload can restore them", async () => {
    const sources = prepareWebSourceReferences([web({ title: "<b>Node</b>" })]);
    const inserted: unknown[] = [];
    const supabase = {
      from(table: string) {
        expect(table).toBe("message_sources");
        return {
          insert(rows: unknown) {
            inserted.push(rows);
            return Promise.resolve({ error: null });
          },
          select() {
            return {
              eq() {
                return {
                  order() {
                    return Promise.resolve({
                      data: [
                        {
                          message_id: "assistant-1",
                          ordinal: 1,
                          kind: "web" as const,
                          title: sources[0]!.title,
                          url: sources[0]!.url,
                          domain: sources[0]!.domain,
                        },
                      ],
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };

    const saved = await persistMessageSources({
      supabase,
      userId: "user-1",
      conversationId: "conv-1",
      messageId: "assistant-1",
      sources,
    });
    expect(saved).toEqual({ ok: true });
    expect(inserted[0]).toEqual([
      expect.objectContaining({
        message_id: "assistant-1",
        ordinal: 1,
        handle: "web:1",
        title: "Node",
        url: "https://nodejs.org/en",
        domain: "nodejs.org",
      }),
    ]);

    const loaded = await loadMessageSourcesByConversation(supabase, "conv-1");
    expect(loaded.byMessage.get("assistant-1")).toEqual([
      {
        ordinal: 1,
        kind: "web",
        title: "Node",
        url: "https://nodejs.org/en",
        domain: "nodejs.org",
      },
    ]);
  });

  it("soft-fails when the message_sources table is not deployed", async () => {
    const supabase = {
      from() {
        return {
          insert: () => Promise.resolve({ error: { code: "42P01" } }),
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: null, error: { code: "42P01" } }),
            }),
          }),
        };
      },
    };
    await expect(
      persistMessageSources({
        supabase,
        userId: "u",
        conversationId: "c",
        messageId: "m",
        sources: prepareWebSourceReferences([web()]),
      }),
    ).resolves.toEqual({ ok: true, unavailable: true });
    await expect(loadMessageSourcesByConversation(supabase, "c")).resolves.toMatchObject({
      unavailable: true,
      error: false,
    });
  });
});

describe("citations degradation", () => {
  it("prepares no sources when the web pipeline returned none", () => {
    expect(attachWebCitationHandles([])).toEqual({ sources: [], web: [] });
    expect(toCitationSourceViews([])).toEqual([]);
  });

  it("rejects javascript: and credentialed URLs", () => {
    expect(prepareWebSourceReferences([web({ url: "javascript:alert(1)" })])).toEqual([]);
    expect(prepareWebSourceReferences([web({ url: "https://user:pass@evil.test/" })])).toEqual([]);
  });
});
