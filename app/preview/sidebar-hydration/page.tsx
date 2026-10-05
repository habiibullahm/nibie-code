import { notFound } from "next/navigation";
import { ChatWorkspace } from "@/components/chat-workspace";
import { requestTime } from "@/lib/chat/groups";
import { modelPickerCopy, type ModelOption } from "@/lib/chat/models";
import { weeklyCreditCost } from "@/lib/usage/policy";
import type { ConversationSummary, PersistedMessage, RoomSummary } from "@/lib/chat/read";

// Dev-only harness: the real signed-in workspace (not the mock `preview` mode) with the data shapes that can make server and client
// disagree: rooms whose names sort differently by locale, threads in rooms and in General across today / yesterday / older,
// threads sitting right on a UTC midnight boundary, and an active thread inside a room.
const models: ModelOption[] = (["Fast", "Balanced", "High"] as const).map((id) => ({ id, ...modelPickerCopy[id], credits: weeklyCreditCost[id] }));

const roomNames = ["alpha", "Alpha", "Éclair", "Zeta 10", "Zeta 2", "ünder", "東京", "🚀 Launch", "a-b", "a b", "Ångström", "ZZ"];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export default async function SidebarHydrationPreview({ searchParams }: { searchParams: Promise<{ active?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const now = requestTime();
  const hour = 3_600_000;
  const startOfUtcDay = now - (now % 86_400_000);
  const iso = (ms: number) => new Date(ms).toISOString();

  const rooms: RoomSummary[] = roomNames.map((name, index) => ({
    id: uuid(100 + index), name, description: null, instructions: null, created_at: iso(now - 40 * 24 * hour), updated_at: iso(now - 40 * 24 * hour), brief: null, pins: [],
  }));
  const times = [
    now - hour, now - 5 * 60_000, startOfUtcDay + 60_000, startOfUtcDay - 60_000, startOfUtcDay - 23 * hour, now - 26 * hour,
    now - 49 * hour, now - 5 * 24 * hour, now - 33 * 24 * hour, now - 120 * 24 * hour,
  ];
  const conversations: ConversationSummary[] = times.flatMap((time, index) => [
    { id: uuid(index * 2 + 1), title: `General thread ${index}`, selected_model: "Balanced", room_id: null, archived_at: null, created_at: iso(time), updated_at: iso(time) },
    { id: uuid(index * 2 + 2), title: `Room thread ${index}`, selected_model: "Fast", room_id: rooms[index % rooms.length].id, archived_at: null, created_at: iso(time), updated_at: iso(time) },
  ]);
  const requested = query.active ?? uuid(2);
  const active = conversations.find((item) => item.id === requested) ?? conversations[1];

  // Messages on several days, so timestamps (when the viewer turns them on) are formatted in the viewer's own locale and zone.
  const messages: PersistedMessage[] = [now - 50 * hour, now - 26 * hour, now - 2 * hour, now - 5 * 60_000].flatMap((time, index) => [
    { id: uuid(500 + index * 2), role: "user" as const, content: `Question ${index}`, position: index * 2 + 1, status: "complete" as const, created_at: iso(time) },
    { id: uuid(501 + index * 2), role: "assistant" as const, content: `Answer ${index}`, position: index * 2 + 2, status: "complete" as const, created_at: iso(time + 30_000) },
  ]);

  return <ChatWorkspace email="hydration@nibie.local" models={models} renderedAt={now}
    initialData={{ conversations, archivedConversations: [], rooms, messages, activeId: active.id, error: null }} />;
}
