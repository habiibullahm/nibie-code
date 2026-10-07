/** Server-owned citation source kinds. Memory is not a citation source in V1. */
export type SourceKind = "web" | "room_file" | "attachment";

/**
 * Canonical citation metadata. Built on the server from retrieved sources.
 * The model only ever sees deterministic handles (e.g. [SOURCE:web:1]); never trust
 * model-invented URLs as citation metadata.
 */
export type SourceReference = {
  /** Stable handle id without brackets, e.g. `web:1`. */
  id: string;
  kind: SourceKind;
  title: string;
  /** Present for web; null for room_file / attachment until those cite paths exist. */
  url: string | null;
  domain: string | null;
  excerpt?: string | null;
  retrievedAt?: string | null;
  /** Opaque id for room_file / attachment rows when those kinds are cited. */
  sourceId?: string | null;
};

/** Client-safe citation payload (no long excerpts). */
export type CitationSourceView = {
  ordinal: number;
  kind: SourceKind;
  title: string;
  url: string | null;
  domain: string | null;
};

export type CitationParseResult = {
  /** Visible text with `[n]` markers for known sources; unknown handles stripped to plain text. */
  text: string;
  /** Ordinals that appeared in the output and mapped to prepared sources (1-based). */
  citedOrdinals: number[];
  citationCount: number;
  invalidCitationCount: number;
};
