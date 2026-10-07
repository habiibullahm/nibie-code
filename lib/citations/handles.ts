import type { SourceKind } from "@/lib/citations/types";

/** Open marker the model is instructed to emit, e.g. `[SOURCE:web:1]`. */
export const SOURCE_HANDLE_OPEN = "[SOURCE:";
export const SOURCE_HANDLE_PATTERN = /\[SOURCE:(web|room_file|attachment):(\d+)\]/g;

const KINDS = ["web", "room_file", "attachment"] as const;

/**
 * True when `fragment` could still become a valid `[SOURCE:kind:n]` marker.
 * Includes short ambiguous opens (`[`, `[S`, …) so stream chunks that split
 * before `SOURCE` do not leak raw `[SOURCE:…]` into visible text.
 */
export function isSourceHandlePrefix(fragment: string): boolean {
  if (!fragment.startsWith("[")) return false;
  // Complete markers are not prefixes.
  if (/^\[SOURCE:(?:web|room_file|attachment):\d+\]$/.test(fragment)) return false;
  // Hold "[", "[S", …, "[SOURCE:" while they remain a prefix of the open marker.
  if (SOURCE_HANDLE_OPEN.startsWith(fragment)) return true;
  if (!fragment.startsWith(SOURCE_HANDLE_OPEN)) return false;

  const afterColon = fragment.slice(SOURCE_HANDLE_OPEN.length);
  if (afterColon === "") return true;
  const second = afterColon.indexOf(":");
  if (second === -1) {
    // Partial kind, e.g. "we" or "room_fi"
    return KINDS.some((kind) => kind.startsWith(afterColon));
  }
  const kind = afterColon.slice(0, second);
  if (!(KINDS as readonly string[]).includes(kind)) return false;
  const indexPart = afterColon.slice(second + 1);
  if (indexPart === "") return true;
  if (indexPart.endsWith("]")) {
    const body = indexPart.slice(0, -1);
    return /^\d+$/.test(body) && Number(body) >= 1;
  }
  return /^\d+$/.test(indexPart);
}

/** True when a held prefix is clearly citation syntax (safe to drop on finish). */
export function isCommittedSourceHandlePrefix(fragment: string): boolean {
  return fragment.startsWith("[SOURCE");
}

export function citationHandle(kind: SourceKind, index: number): string {
  return `${kind}:${index}`;
}

export function formatSourceMarker(kind: SourceKind, index: number): string {
  return `[SOURCE:${citationHandle(kind, index)}]`;
}

export function parseSourceMarker(token: string): { kind: SourceKind; index: number } | null {
  const match = /^\[SOURCE:(web|room_file|attachment):(\d+)\]$/.exec(token);
  if (!match) return null;
  const index = Number(match[2]);
  if (!Number.isInteger(index) || index < 1) return null;
  return { kind: match[1] as SourceKind, index };
}

/** Map prepared source id (`web:1`) → 1-based display ordinal. */
export function ordinalForHandle(
  handleId: string,
  sources: readonly { id: string }[],
): number | null {
  const index = sources.findIndex((source) => source.id === handleId);
  return index >= 0 ? index + 1 : null;
}
