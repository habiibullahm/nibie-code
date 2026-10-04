import type { RoomPinContext } from "@/lib/context/pin-context";
import { normalizePreferenceText } from "@/lib/preferences/instructions";
import { roomBriefFieldLimit, roomInstructionsLimit, roomNameLimit } from "@/lib/rooms/types";

export type RoomBriefContext = {
  goal: string;
  currentFocus: string;
  importantDecisions: string;
  openQuestions: string;
  next: string;
};

// Already authorized for this thread. Null means a general thread.
export type RoomContextInput = {
  name: string;
  instructions: string | null;
  brief: RoomBriefContext | null;
  pins?: RoomPinContext[];
};

export type RoomCategory = "Instructions" | "Brief";

export type RoomPiece = {
  kind: "instructions" | "brief";
  categories: RoomCategory[];
  text: string;
};

const briefFields: Array<{ key: keyof RoomBriefContext; label: string }> = [
  { key: "goal", label: "Goal" },
  { key: "currentFocus", label: "Current focus" },
  { key: "importantDecisions", label: "Important decisions" },
  { key: "openQuestions", label: "Open questions" },
  { key: "next", label: "Next" },
];

function boundedText(value: string | null | undefined, max: number) {
  if (!value) return null;
  const normalized = normalizePreferenceText(value);
  if (!normalized || [...normalized].length > max) return null;
  return normalized;
}

function quoteUserText(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Instructions stay ahead of the brief so a tight budget keeps the guidance and drops the brief whole.
export function roomPieces(room: RoomContextInput | null | undefined): RoomPiece[] {
  if (!room) return [];
  const name = boundedText(room.name, roomNameLimit);
  if (!name) return [];
  const quotedName = quoteUserText(name);
  const pieces: RoomPiece[] = [];
  const instructions = boundedText(room.instructions, roomInstructionsLimit);
  if (instructions) {
    pieces.push({ kind: "instructions", categories: ["Instructions"], text: `Room ${quotedName} instructions: ${quoteUserText(instructions)}` });
  }
  const lines = room.brief ? briefFields.flatMap((field) => {
    const value = boundedText(room.brief?.[field.key], roomBriefFieldLimit);
    return value ? [`${field.label}: ${quoteUserText(value)}`] : [];
  }) : [];
  if (lines.length) pieces.push({ kind: "brief", categories: ["Brief"], text: `Room ${quotedName} brief:\n${lines.join("\n")}` });
  return pieces;
}

export function roomReason(categories: RoomCategory[]) {
  const included = new Set(categories);
  if (included.has("Instructions") && included.has("Brief")) return "Instructions and brief";
  if (included.has("Instructions")) return "Instructions";
  if (included.has("Brief")) return "Brief";
  return "";
}
