import type { SourceKind } from "@/lib/citations/types";

/** Open marker the model is instructed to emit, e.g. `[SOURCE:web:1]`. */
export const SOURCE_HANDLE_OPEN = "[SOURCE:";
export const SOURCE_HANDLE_PATTERN = /\[SOURCE:(web|room_file|attachment):(\d+)\]/g;

const KINDS = ["web", "room_file", "attachment"] as const;

/** True when `fragment` is a proper prefix of a valid `[SOURCE:kind:n]` marker. */
export function isSourceHandlePrefix(fragment: string): boolean {
  if (!fragment.startsWith("[SOURCE")) return false;
  if (fragment.length < "[SOURCE".length) return false;
  // Complete markers are not prefixes.
  if (/^\[SOURCE:(?:web|room_file|attachment):\d+\]$/.test(fragment)) return false;
  const rest = fragment.slice("[SOURCE".length);
  if (rest === "") return true;
  if (!rest.startsWith(":")) return false;
  const afterColon = rest.slice(1);
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
