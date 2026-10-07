import "server-only";

import { z } from "zod";
import { WEB_SEARCH_ACTION_ID } from "@/lib/actions/ids";
import type { ActionDefinition, ActionResult, ActionResultItem } from "@/lib/actions/types";
import { getWebSearchConfig } from "@/lib/web/config";
import { getWebSearchProvider } from "@/lib/web/provider";
import { runWebSearchPipeline } from "@/lib/web/pipeline";
import type { WebContextInput } from "@/lib/web/types";

export { WEB_SEARCH_ACTION_ID };

export const webSearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(2000),
});

export type WebSearchActionInput = z.infer<typeof webSearchInputSchema>;

/** Extra metadata attached to successful results for chat/citation wiring. */
export type WebSearchActionMetadata = {
  sources: WebContextInput[];
  searchResultCount: number;
  pagesFetched: number;
  degraded: boolean;
  failureCategory?: string;
};

/**
 * First V1 Action: READ web search wrapping the existing lib/web pipeline
 * (SSRF, bounds, sanitize, degrade). Citation-compatible sources are returned
 * in result.metadata.sources for the chat route.
 */
export const webSearchAction: ActionDefinition<typeof webSearchInputSchema> = {
  id: WEB_SEARCH_ACTION_ID,
  title: "Web Search",
  description: "Search the public web for current information. Read-only.",
  capability: "read",
  requiresConfirmation: false,
  inputSchema: webSearchInputSchema,
  async execute(ctx, input, signal) {
    const config = getWebSearchConfig();
    const provider = getWebSearchProvider();
    if (!config || !provider) {
      return {
        ok: false,
        items: [],
        summary: "Web search is not configured.",
        errorCode: "execution_failed",
        errorMessage: "provider_unconfigured",
        metadata: {
          sources: [],
          searchResultCount: 0,
          pagesFetched: 0,
          degraded: true,
          failureCategory: "provider_unconfigured",
        } satisfies WebSearchActionMetadata,
      };
    }

    if (signal.aborted || ctx.signal.aborted) {
      return {
        ok: false,
        items: [],
        summary: "Web search cancelled.",
        errorCode: "aborted",
        errorMessage: "aborted",
      };
    }

    const pipeline = await runWebSearchPipeline(input.query, {
      signal,
      provider,
      config,
    });

    if (signal.aborted || ctx.signal.aborted) {
      return {
        ok: false,
        items: [],
        summary: "Web search cancelled.",
        errorCode: "aborted",
        errorMessage: "aborted",
        metadata: {
          sources: [],
          searchResultCount: pipeline.searchResultCount,
          pagesFetched: pipeline.pagesFetched,
          degraded: true,
          failureCategory: "aborted",
        } satisfies WebSearchActionMetadata,
      };
    }

    const items = sourcesToItems(pipeline.sources);
    const metadata: WebSearchActionMetadata = {
      sources: pipeline.sources,
      searchResultCount: pipeline.searchResultCount,
      pagesFetched: pipeline.pagesFetched,
      degraded: pipeline.degraded,
      ...(pipeline.failureCategory ? { failureCategory: pipeline.failureCategory } : {}),
    };

    // Empty results are a structured soft failure (degrade), not a throw — chat continues.
    if (!pipeline.sources.length) {
      return {
        ok: false,
        items: [],
        summary: "Web search returned no usable sources.",
        errorCode: "execution_failed",
        errorMessage: pipeline.failureCategory ?? "empty",
        metadata,
      };
    }

    return {
      ok: true,
      items,
      summary: `Found ${items.length} web source${items.length === 1 ? "" : "s"}.`,
      metadata,
    } satisfies ActionResult;
  },
};

function sourcesToItems(sources: WebContextInput[]): ActionResultItem[] {
  return sources.map((source) => ({
    title: source.title.trim() || source.domain,
    url: source.url,
    snippet: source.text.slice(0, 400),
    provenance: source.retrieval === "web_snippet_only" ? "web_snippet_only" : "web_search",
    data: {
      domain: source.domain,
      retrieval: source.retrieval,
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    },
  }));
}

export function webSourcesFromActionResult(result: ActionResult): WebContextInput[] {
  const meta = result.metadata as WebSearchActionMetadata | undefined;
  if (!meta || !Array.isArray(meta.sources)) return [];
  return meta.sources;
}
