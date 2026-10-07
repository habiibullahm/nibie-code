import { prepareWebSourceReferences } from "@/lib/citations/prepare";
import type { SourceReference } from "@/lib/citations/types";
import type { WebContextInput } from "@/lib/web/types";

/**
 * Prepare canonical SourceReferences and stamp matching web context rows with
 * citationHandle so the model sees cite_as handles. Rows without a safe URL are dropped.
 * Handle indices match prepare order (`web:1` …).
 */
export function attachWebCitationHandles(
  inputs: readonly WebContextInput[],
  retrievedAt?: Date,
): { sources: SourceReference[]; web: WebContextInput[] } {
  const sources = prepareWebSourceReferences(inputs, retrievedAt);
  if (!sources.length) return { sources: [], web: [] };

  const web: WebContextInput[] = [];
  let next = 0;
  for (const input of inputs) {
    if (next >= sources.length) break;
    const ref = sources[next]!;
    // prepareWebSourceReferences walks inputs in the same order and skips unsafe URLs.
    // Align by sanitized URL so a skipped input does not consume a handle.
    let sanitized: string | null = null;
    try {
      const parsed = new URL(input.url.trim());
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password) {
        sanitized = parsed.toString();
      }
    } catch {
      sanitized = null;
    }
    if (!sanitized || sanitized !== ref.url) continue;
    web.push({
      ...input,
      url: ref.url!,
      title: ref.title,
      domain: ref.domain ?? input.domain,
      citationHandle: ref.id,
    });
    next += 1;
  }

  return { sources: sources.slice(0, web.length), web };
}
