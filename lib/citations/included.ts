import type { SourceReference } from "@/lib/citations/types";

/**
 * Keep only SourceReferences whose handles were actually written into the
 * rendered web context. Preserves prepare order; display ordinals are 1-based
 * over this filtered list.
 */
export function citationSourcesIncludedInContext(
  prepared: readonly SourceReference[],
  includedHandles: readonly string[],
): SourceReference[] {
  if (!prepared.length || !includedHandles.length) return [];
  const allowed = new Set(includedHandles);
  return prepared.filter((source) => allowed.has(source.id));
}
