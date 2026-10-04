import type { RoomPinContext } from "@/lib/context/pin-context";
import type { RoomContextInput } from "@/lib/context/room-context";

export type RoomBriefRow = {
  goal: string | null;
  current_focus: string | null;
  important_decisions: string | null;
  open_questions: string | null;
  next_step: string | null;
};

export type RoomContextRow = {
  name: string;
  instructions: string | null;
};

export type PinContextRow = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
};

export function roomContextFromRows(room: RoomContextRow | null, brief: RoomBriefRow | null, pins: PinContextRow[] | null = []): RoomContextInput | null {
  if (!room) return null;
  const mappedPins: RoomPinContext[] = (pins ?? []).map((pin) => ({
    id: pin.id,
    title: pin.title,
    content: pin.content,
    updatedAt: pin.updated_at,
  }));
  return {
    name: room.name,
    instructions: room.instructions,
    brief: brief
      ? {
        goal: brief.goal ?? "",
        currentFocus: brief.current_focus ?? "",
        importantDecisions: brief.important_decisions ?? "",
        openQuestions: brief.open_questions ?? "",
        next: brief.next_step ?? "",
      }
      : null,
    pins: mappedPins,
  };
}
