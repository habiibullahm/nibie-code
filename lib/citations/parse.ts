import {
  SOURCE_HANDLE_PATTERN,
  isCommittedSourceHandlePrefix,
  isSourceHandlePrefix,
  parseSourceMarker,
} from "@/lib/citations/handles";
import type { CitationParseResult, SourceReference } from "@/lib/citations/types";

function sourceIndex(sources: readonly SourceReference[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < sources.length; i += 1) {
    map.set(sources[i]!.id, i + 1);
  }
  return map;
}

/**
 * Transform completed assistant text: known `[SOURCE:kind:n]` → `[ordinal]`;
 * unknown handles become empty (no fake citation). Does not invent sources.
 */
export function parseCitationReferences(
  input: string,
  sources: readonly SourceReference[],
): CitationParseResult {
  if (!input) {
    return { text: "", citedOrdinals: [], citationCount: 0, invalidCitationCount: 0 };
  }
  if (!sources.length) {
    // Strip any invented handles so they never look like real citations.
    let invalid = 0;
    const text = input.replace(SOURCE_HANDLE_PATTERN, () => {
      invalid += 1;
      return "";
    });
    return {
      text: text.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1"),
      citedOrdinals: [],
      citationCount: 0,
      invalidCitationCount: invalid,
    };
  }

  const byId = sourceIndex(sources);
  const cited = new Set<number>();
  let citationCount = 0;
  let invalidCitationCount = 0;

  const text = input.replace(SOURCE_HANDLE_PATTERN, (token) => {
    const parsed = parseSourceMarker(token);
    if (!parsed) {
      invalidCitationCount += 1;
      return "";
    }
    const handleId = `${parsed.kind}:${parsed.index}`;
    const ordinal = byId.get(handleId);
    if (ordinal == null) {
      invalidCitationCount += 1;
      return "";
    }
    cited.add(ordinal);
    citationCount += 1;
    return `[${ordinal}]`;
  });

  return {
    text,
    citedOrdinals: [...cited].sort((a, b) => a - b),
    citationCount,
    invalidCitationCount,
  };
}

/**
 * Stream-safe filter: holds incomplete `[SOURCE…` prefixes, emits visible `[n]` for
 * known handles, and drops unknown handles as plain (empty) text.
 */
export function createCitationStreamFilter(sources: readonly SourceReference[]) {
  const byId = sourceIndex(sources);
  let pending = "";
  let finished = false;
  let citationCount = 0;
  let invalidCitationCount = 0;
  const cited = new Set<number>();

  const emitToken = (token: string): string => {
    const parsed = parseSourceMarker(token);
    if (!parsed) {
      invalidCitationCount += 1;
      return "";
    }
    const handleId = `${parsed.kind}:${parsed.index}`;
    const ordinal = byId.get(handleId);
    if (ordinal == null) {
      invalidCitationCount += 1;
      return "";
    }
    cited.add(ordinal);
    citationCount += 1;
    return `[${ordinal}]`;
  };

  const flushBuffer = (mode: "stream" | "finish"): string => {
    let out = "";
    let index = 0;
    while (index < pending.length) {
      const start = pending.indexOf("[", index);
      if (start === -1) {
        out += pending.slice(index);
        pending = "";
        return out;
      }
      out += pending.slice(index, start);
      const rest = pending.slice(start);
      const complete = /^\[SOURCE:(?:web|room_file|attachment):\d+\]/.exec(rest);
      if (complete) {
        out += emitToken(complete[0]!);
        index = start + complete[0]!.length;
        continue;
      }
      if (isSourceHandlePrefix(rest)) {
        if (mode === "stream") {
          // Incomplete marker at end — keep waiting for more chunks.
          pending = rest;
          return out;
        }
        // Finish: drop clear `[SOURCE…` prefixes (never leak internal syntax).
        // Ambiguous opens like `[` / `[S` are ordinary text — emit them.
        if (isCommittedSourceHandlePrefix(rest)) {
          invalidCitationCount += 1;
          pending = "";
          return out;
        }
        out += rest;
        pending = "";
        return out;
      }
      // Not a source-handle prefix: emit the '[' and continue scanning.
      out += "[";
      index = start + 1;
    }
    pending = "";
    return out;
  };

  return {
    push(chunk: string) {
      if (finished || !chunk) return "";
      pending += chunk;
      return flushBuffer("stream");
    },
    finish() {
      if (finished) return "";
      finished = true;
      return flushBuffer("finish");
    },
    get citationCount() {
      return citationCount;
    },
    get invalidCitationCount() {
      return invalidCitationCount;
    },
    get citedOrdinals() {
      return [...cited].sort((a, b) => a - b);
    },
  };
}
