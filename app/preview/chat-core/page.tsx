import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { PersistedMessage } from "@/lib/chat/read";
import { validateConversationId } from "@/lib/chat/validation";
import { ChatCoreComposerFixture } from "@/tests/fixtures/chat-core-composer";
import { longReply, longReplyFixtureId } from "@/tests/fixtures/long-reply";
import { ChatWorkspace } from "@/components/chat-workspace";
import { modelPickerCopy, type ModelOption } from "@/lib/chat/models";
import { weeklyCreditCost } from "@/lib/usage/policy";
import { requestTime } from "@/lib/chat/groups";

// Dev-only harness: all three modes, independent of which providers this machine has configured.
const workspaceModels: ModelOption[] = (["Fast", "Balanced", "High"] as const).map((id) => ({ id, ...modelPickerCopy[id], credits: weeklyCreditCost[id] }));

export default async function ChatCorePreview({ searchParams }: { searchParams: Promise<{ workspace?: string; mode?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  if (query.workspace === "1") {
    const mode = query.mode === "Fast" || query.mode === "High" ? query.mode : "Balanced";
    const stamp = "2026-10-04T00:00:00.000Z";
    const conversation = { id: "5e9bdcca-9205-4fea-a773-13952bb78c44", title: "Stop acceptance", selected_model: mode, room_id: null, created_at: stamp, updated_at: stamp };
    const messages: PersistedMessage[] = [];
    const jar = await cookies();
    const saved = jar.get("chat-core-stop-snapshot")?.value;
    // Set once the stopped partial has been saved, so a reload shows the persisted text rather than the claim placeholder.
    const stoppedContent = jar.get("chat-core-stop-partial")?.value === "1" ? "Partial first response" : "…";
    // A saved thread for streaming regressions. A long reply is named by fixture id because it does not fit in a cookie.
    const thread = jar.get("chat-core-thread")?.value;
    if (thread) {
      const rows: unknown = JSON.parse(decodeURIComponent(thread));
      if (Array.isArray(rows)) messages.push(...(rows as PersistedMessage[]).map((row) => row.content === longReplyFixtureId ? { ...row, content: longReply } : row));
    }
    if (saved) {
      const ids: unknown = JSON.parse(decodeURIComponent(saved));
      if (Array.isArray(ids) && ids.length === 2 && ids.every((id) => validateConversationId(id).success)) {
        messages.push(
          { id: ids[0], role: "user", content: "First synthetic prompt", status: "complete", position: 1 },
          { id: "e3b624e6-d792-47a8-8ff2-46724452c1ca", role: "assistant", content: stoppedContent, status: "interrupted", position: 2 },
          { id: ids[1], role: "user", content: "Next before persistence confirmation", status: "complete", position: 3 },
          { id: "22222222-2222-4222-8222-222222222222", role: "assistant", content: "Second response completed.", status: "complete", position: 4 },
        );
      }
    }
    return <ChatWorkspace email="acceptance@nibie.local" models={workspaceModels} renderedAt={requestTime()}
      initialData={{ conversations: [conversation], archivedConversations: [], rooms: [], messages, activeId: conversation.id, error: null }} />;
  }
  return <ChatCoreComposerFixture />;
}
