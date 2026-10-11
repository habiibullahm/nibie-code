"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { useRouter } from "next/navigation";
import { useStableCallback } from "@/components/use-stable-callback";
import { createPinAction, deletePinAction, updatePinAction } from "@/app/actions/pins";
import { createRoomAction, deleteRoomAction, updateRoomAction, updateRoomBriefAction } from "@/app/actions/rooms";
import type { RoomSummary } from "@/lib/chat/read";
import type { PinDraft } from "@/lib/pins/types";
import type { RoomBriefFields, RoomDraft } from "@/lib/rooms/types";
import { compareNames, compareText } from "@/lib/chat/order";

type RoomInput = {
  preview: boolean;
  serverRooms: RoomSummary[] | undefined;
  mockRooms: RoomSummary[];
  router: ReturnType<typeof useRouter>;
  getActiveRoom: () => RoomSummary | null;
  onCreated: (id: string) => void;
  onDeleted: (id: string) => void;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useRoomManagement({ preview, serverRooms, mockRooms, router, getActiveRoom, onCreated, onDeleted, setNotice }: RoomInput) {
  const [roomListStamp, setRoomListStamp] = useState(serverRooms);
  const [roomOverrides, setRoomOverrides] = useState<Record<string, RoomSummary | null>>({});
  if (!preview && serverRooms !== roomListStamp) {
    setRoomListStamp(serverRooms);
    setRoomOverrides({});
  }
  const rooms = useMemo(() => {
    const source = preview ? mockRooms : (serverRooms ?? []);
    const map = new Map(source.map((room) => [room.id, room]));
    for (const [id, override] of Object.entries(roomOverrides)) {
      if (override) map.set(id, override);
      else map.delete(id);
    }
    return [...map.values()].sort((left, right) => compareNames(left.name, right.name) || compareText(left.id, right.id));
  }, [preview, roomOverrides, serverRooms, mockRooms]);
  const createRoom = useStableCallback(async (draft: RoomDraft, brief: RoomBriefFields) => {
    const nextBrief = { goal: brief.goal, current_focus: brief.currentFocus, important_decisions: brief.importantDecisions, open_questions: brief.openQuestions, next_step: brief.next };
    if (preview) {
      const room: RoomSummary = { id: `preview-room-${crypto.randomUUID()}`, name: draft.name.trim(), description: draft.description?.trim() || null, instructions: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), brief: nextBrief, pins: [] };
      setRoomOverrides((items) => ({ ...items, [room.id]: room }));
      onCreated(room.id);
      return {};
    }
    const result = await createRoomAction(draft, brief);
    if (result.error || !result.data) return { error: result.error ?? "We couldn't save that change. Please try again." };
    const room: RoomSummary = { ...result.data, pins: [] };
    setRoomOverrides((items) => ({ ...items, [room.id]: room }));
    onCreated(room.id);
    router.refresh();
    return {};
  });
  const saveRoom = useStableCallback(async (patch: { name: string; description: string | null; instructions: string | null }) => {
    const activeRoom = getActiveRoom();
    if (!activeRoom) return { error: "That room is no longer available." };
    if (preview) {
      setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, ...patch, updated_at: new Date().toISOString() } }));
      return {};
    }
    const result = await updateRoomAction(activeRoom.id, patch);
    if (result.error || !result.data) return { error: result.error ?? "We couldn't save that change. Please try again." };
    const saved = result.data;
    setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, ...saved, brief: activeRoom.brief, pins: activeRoom.pins } }));
    router.refresh();
    return {};
  });
  const saveBrief = useStableCallback(async (brief: RoomBriefFields) => {
    const activeRoom = getActiveRoom();
    if (!activeRoom) return { error: "That room is no longer available." };
    const nextBrief = { goal: brief.goal, current_focus: brief.currentFocus, important_decisions: brief.importantDecisions, open_questions: brief.openQuestions, next_step: brief.next };
    if (preview) {
      setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, brief: nextBrief, updated_at: new Date().toISOString() } }));
      return {};
    }
    const result = await updateRoomBriefAction(activeRoom.id, brief);
    if (result.error) return { error: result.error };
    setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, brief: nextBrief, updated_at: new Date().toISOString() } }));
    router.refresh();
    return {};
  });
  const createPin = useStableCallback(async (draft: PinDraft) => {
    const activeRoom = getActiveRoom();
    if (!activeRoom) return { error: "That room is no longer available." };
    if (preview) {
      const pin = { id: `preview-pin-${crypto.randomUUID()}`, room_id: activeRoom.id, title: draft.title, content: draft.content, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, pins: [pin, ...activeRoom.pins] } }));
      return {};
    }
    const result = await createPinAction(activeRoom.id, draft);
    if (result.error || !result.data) return { error: result.error ?? "We couldn't save that change. Please try again." };
    setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, pins: [result.data!, ...activeRoom.pins.filter((pin) => pin.id !== result.data!.id)] } }));
    router.refresh();
    return {};
  });
  const updatePin = useStableCallback(async (id: string, draft: PinDraft) => {
    const activeRoom = getActiveRoom();
    if (!activeRoom) return { error: "That room is no longer available." };
    if (preview) {
      const pins = activeRoom.pins.map((pin) => pin.id === id ? { ...pin, title: draft.title, content: draft.content, updated_at: new Date().toISOString() } : pin)
        .sort((left, right) => compareText(right.updated_at, left.updated_at) || compareText(left.id, right.id));
      setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, pins } }));
      return {};
    }
    const result = await updatePinAction(id, draft);
    if (result.error || !result.data) return { error: result.error ?? "We couldn't save that change. Please try again." };
    const saved = result.data;
    setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, pins: [saved, ...activeRoom.pins.filter((pin) => pin.id !== saved.id)] } }));
    router.refresh();
    return {};
  });
  const removePin = useStableCallback(async (id: string) => {
    const activeRoom = getActiveRoom();
    if (!activeRoom) return { error: "That room is no longer available." };
    if (!preview) {
      const result = await deletePinAction(id);
      if (result.error) return { error: result.error };
    }
    setRoomOverrides((items) => ({ ...items, [activeRoom.id]: { ...activeRoom, pins: activeRoom.pins.filter((pin) => pin.id !== id) } }));
    if (!preview) router.refresh();
    return {};
  });
  const deleteRoomById = useStableCallback(async (id: string) => {
    const room = rooms.find((item) => item.id === id);
    if (!room) return { error: "That room is no longer available." };
    if (!preview) {
      const result = await deleteRoomAction(id);
      if (result.error) return { error: result.error };
    }
    setRoomOverrides((items) => ({ ...items, [id]: null }));
    onDeleted(id);
    if (!preview) router.refresh();
    return {};
  });
  const removeRoom = useStableCallback(async () => { const activeRoom = getActiveRoom(); return activeRoom ? deleteRoomById(activeRoom.id) : { error: "That room is no longer available." }; });
  const deleteRoomFromSidebar = useStableCallback(async (id: string) => {
    const result = await deleteRoomById(id);
    if (result.error) setNotice(result.error);
    return result;
  });
  return { rooms, createRoom, saveRoom, saveBrief, createPin, updatePin, removePin, removeRoom, deleteRoomFromSidebar };
}
