import {
  citationHandle,
  formatSourceMarker,
} from "@/lib/citations/handles";
import {
  sanitizeCitationDomain,
  sanitizeCitationExcerpt,
  sanitizeCitationTitle,
  sanitizeCitationUrl,
} from "@/lib/citations/sanitize";
import type { CitationSourceView, SourceReference } from "@/lib/citations/types";
import type { WebContextInput } from "@/lib/web/types";

export const MAX_PREPARED_SOURCES = 5;
/** Deep Research may prepare up to this many web sources (DB ordinal cap is 20). */
export const MAX_RESEARCH_PREPARED_SOURCES = 10;

/**
 * Build server-owned SourceReference rows from web pipeline outputs.
 * Assigns deterministic handles `web:1`… in list order. Skips sources without a safe URL.
 */
export function prepareWebSourceReferences(
  inputs: readonly WebContextInput[],
  retrievedAt: Date = new Date(),
  maxSources: number = MAX_PREPARED_SOURCES,
): SourceReference[] {
  const limit = Math.min(20, Math.max(1, Math.trunc(maxSources)));
  const sources: SourceReference[] = [];
  const iso = retrievedAt.toISOString();
  for (const input of inputs) {
    if (sources.length >= limit) break;
    const url = sanitizeCitationUrl(input.url);
    if (!url) continue;
    const domain = sanitizeCitationDomain(input.domain, url);
    const index = sources.length + 1;
    sources.push({
      id: citationHandle("web", index),
      kind: "web",
      title: sanitizeCitationTitle(input.title || domain || "Web source"),
      url,
      domain,
      excerpt: sanitizeCitationExcerpt(input.text),
      retrievedAt: iso,
      sourceId: null,
    });
  }
  return sources;
}

/** Client / SSE payload: ordinals, titles, domains, safe URLs — no excerpts. */
export function toCitationSourceViews(sources: readonly SourceReference[]): CitationSourceView[] {
  return sources.map((source, index) => ({
    ordinal: index + 1,
    kind: source.kind,
    title: source.title,
    url: source.url,
    domain: source.domain,
  }));
}

/** Authoritative instruction for the core system prompt when citation sources are present. */
export function citationInstructionFor(sources: readonly SourceReference[]): string {
  if (!sources.length) return "";
  const listed = sources
    .map((source) => `${formatSourceMarker(source.kind, Number(source.id.split(":")[1]))} — ${source.title}${source.domain ? ` (${source.domain})` : ""}`)
    .join("; ");
  return [
    "Citation rules for this reply (required):",
    "When a factual claim is supported by a listed source, append that source's exact handle immediately after the claim (for example [SOURCE:web:1]).",
    "Cite only with those exact [SOURCE:…] handles — never with prose source lists, footnotes, or phrases that name sites as sources (for example \"Sources:\", \"Sumber:\", \"according to Pluang\", or \"TradingView reports\").",
    "Only use handles from this list. Never invent handles, URLs, titles, or source numbers.",
    "Do not invent a Sources section; the product UI renders sources separately.",
    `Allowed handles: ${listed}.`,
  ].join(" ");
}
