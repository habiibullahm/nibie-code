import { normalizePreferenceText } from "@/lib/preferences/instructions";
import { pinContentLimit, pinTitleLimit } from "@/lib/pins/types";

// Already authorized for this room. Pins are untrusted data, never product rules.
export type RoomPinContext = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};

export type PinPiece = {
  id: string;
  text: string;
};

function boundedText(value: string | null | undefined, max: number) {
  if (!value) return null;
  const normalized = normalizePreferenceText(value);
  if (!normalized || [...normalized].length > max) return null;
  return normalized;
}

function quoteUserText(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Newest edit first. Equal timestamps stay in id order so the same pins always render the same way.
export function orderPins(pins: RoomPinContext[]) {
  return [...pins].sort((left, right) => {
    const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return left.id.localeCompare(right.id);
  });
}

export function renderPin(title: string, content: string) {
  const safeTitle = boundedText(title, pinTitleLimit);
  const safeContent = boundedText(content, pinContentLimit);
  if (!safeTitle || !safeContent) return null;
  return `User-provided pin ${quoteUserText(safeTitle)}: ${quoteUserText(safeContent)}`;
}

export function pinPieces(pins: RoomPinContext[] | null | undefined): PinPiece[] {
  if (!pins?.length) return [];
  return orderPins(pins).flatMap((pin) => {
    const text = renderPin(pin.title, pin.content);
    return text ? [{ id: pin.id, text }] : [];
  });
}
