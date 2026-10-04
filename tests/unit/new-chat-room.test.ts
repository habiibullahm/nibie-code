import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, stream } = vi.hoisted(() => ({ createClient: vi.fn(), stream: vi.fn() }));
// The chat route also reads this conversation's attachments. Tests that are not about attachments see none, while every
// other table still goes to the test's own mock.
const { withoutAttachments } = vi.hoisted(() => {
  const none = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return builder;
  };
  return { withoutAttachments: (client: unknown) => {
    const value = client as { from?: (table: string) => unknown } | undefined;
    if (!value || typeof value.from !== "function") return client;
    const from = value.from;
    return { ...value, from: (table: string) => table === "message_attachments" ? none() : from(table) };
  } };
});
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => withoutAttachments(await createClient()) }));
vi.mock("@/lib/ai/provider", () => ({ chatProvider: { stream } }));
vi.mock("@/lib/ai/registry", () => ({
  getModelOptions: () => ({ models: [{ id: "Balanced", label: "Balanced", description: "" }] }),
  contextCapabilitiesFor: () => ({ contextWindowTokens: 16_384, maxOutputTokens: 2_048 }),
  providerFor: () => "openai",
}));

import { moveConversationAction, startConversationAction } from "../../app/actions/chat";
import { POST } from "../../app/api/chat/route";

const roomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const conversationId = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const messageId = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
const assistantId = "e3b624e6-d792-47a8-8ff2-46724452c1ca";
const auth = { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) };

function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder = {
    select: vi.fn(() => builder), eq: vi.fn(() => builder), order: vi.fn(() => builder),
    limit: vi.fn(() => builder), update: vi.fn(() => builder),
    single: async () => result, maybeSingle: async () => result,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

describe("new chat room persistence and server context", () => {
  beforeEach(() => { createClient.mockReset(); stream.mockReset(); });

  it.each([null, roomId])("persists initial room %s before generation reads its context", async (selectedRoom) => {
    let savedConversation: { id: string; room_id: string | null; selected_model: string } | null = null;
    const insert = vi.fn((row: { selected_model: string; room_id?: string }) => {
      savedConversation = { id: conversationId, selected_model: row.selected_model, room_id: row.room_id ?? null };
      return query(savedConversation);
    });
    let messageReads = 0;
    const from = vi.fn((table: string) => {
      if (table === "conversations") return { ...query(savedConversation), insert };
      if (table === "rooms") return query({ name: "Clinic AI Assistant", instructions: "Use the clinic workflow." });
      if (table === "room_briefs") return query({ goal: "Prepare the clinic launch." });
      if (table === "pins") return query([{ title: "Clinic hours", content: "Open at nine." }]);
      if (table === "user_preferences") return query(null);
      if (table === "messages") {
        messageReads += 1;
        const message = { id: messageId, role: "user", content: "hello", position: 1, status: "complete" };
        return query(messageReads === 1 ? message : messageReads === 2 ? [message] : { id: assistantId });
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    const rpc = vi.fn((name: string) => query(name === "append_user_message"
      ? { id: messageId, position: 1 }
      : { id: assistantId, position: 2, content: "", status: "streaming", replayed: false }));
    createClient.mockResolvedValue({ auth, from, rpc });
    const started = await startConversationAction("Balanced", messageId, "hello", selectedRoom);
    expect(started.error).toBeUndefined();
    expect(started.data?.conversation.room_id).toBe(selectedRoom);
    expect(insert).toHaveBeenCalledWith({ user_id: "owner", title: "New chat", selected_model: "Balanced", ...(selectedRoom ? { room_id: selectedRoom } : {}) });
    stream.mockResolvedValue(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    } }));
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, userMessageId: messageId }),
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"status":"complete"');
    const prompt = stream.mock.calls[0][1] as { role: string; content: string }[];
    const context = prompt.map((message) => message.content).join("\n");
    for (const text of ["Clinic AI Assistant", "Use the clinic workflow.", "Prepare the clinic launch.", "Open at nine."]) {
      if (selectedRoom) expect(context).toContain(text);
      else expect(context).not.toContain(text);
    }
    expect(prompt.at(-1)?.content).toBe("hello");
    if (selectedRoom) expect(from.mock.results.find((result, index) => from.mock.calls[index][0] === "rooms")?.value.eq).toHaveBeenCalledWith("id", selectedRoom);
    else expect(from).not.toHaveBeenCalledWith("rooms");
  });

  it("rejects malformed rooms before accessing the database", async () => {
    expect(await startConversationAction("Balanced", messageId, "hello", "invalid")).toEqual({ error: "Choose a valid room." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["foreign", "deleted"])("safely rejects a %s room when the owner foreign key fails", async () => {
    const insert = vi.fn(() => query(null, { code: "23503", message: "private database detail" }));
    const rpc = vi.fn();
    createClient.mockResolvedValue({ auth, from: () => ({ insert }), rpc });
    expect(await startConversationAction("Balanced", messageId, "hello", roomId)).toEqual({ error: "That room is no longer available." });
    expect(insert).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("moves General → Room A → Room B → General and uses the saved context for the next request", async () => {
    const roomB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const conversation = { id: conversationId, selected_model: "Balanced", room_id: null as string | null };
    const history = [{ role: "user", content: "Help me draft pricing", position: 1, status: "complete" }, { id: messageId, role: "user", content: "continue", position: 2, status: "complete" }];
    const originalHistory = structuredClone(history);
    let reads = 0;
    const update = vi.fn((row: { room_id: string | null }) => { conversation.room_id = row.room_id; return query({ id: conversationId }); });
    const from = vi.fn((table: string) => {
      if (table === "conversations") return { ...query(conversation), update };
      if (table === "rooms") return query({ name: conversation.room_id === roomId ? "Clinic AI Assistant" : "Other Room", instructions: "Shared instructions" });
      if (table === "room_briefs") return query({ goal: "Shared goal" });
      if (table === "pins") return query([{ title: "Shared pin", content: "Room pin content" }]);
      if (table === "user_preferences") return query(null);
      if (table === "messages") { reads += 1; return query(reads === 1 ? history[1] : reads === 2 ? [...history].reverse() : { id: assistantId }); }
      throw new Error(`Unexpected table: ${table}`);
    });
    createClient.mockResolvedValue({ auth, from, rpc: () => query({ id: assistantId, position: 3, content: "", status: "streaming", replayed: false }) });
    for (const target of [roomId, roomB, null]) {
      from.mockClear(); reads = 0; stream.mockClear();
      expect(await moveConversationAction(conversationId, target)).toEqual({});
      expect(conversation.room_id).toBe(target);
      expect(from).toHaveBeenCalledOnce();
      expect(from).toHaveBeenCalledWith("conversations");
      expect(update.mock.calls.at(-1)?.[0]).toEqual({ room_id: target, updated_at: expect.any(String) });
      expect(history).toEqual(originalHistory);
      stream.mockResolvedValue(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Continue"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      } }));
      const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, userMessageId: messageId }) }));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"status":"complete"');
      const prompt = stream.mock.calls[0][1] as { role: string; content: string }[];
      const text = prompt.map((message) => message.content).join("\n");
      expect(text).toContain("Help me draft pricing");
      expect(prompt.at(-1)?.content).toBe("continue");
      for (const context of ["Shared instructions", "Shared goal", "Room pin content"]) {
        if (target) expect(text).toContain(context);
        else expect(text).not.toContain(context);
      }
      if (target === roomB) { expect(text).toContain("Other Room"); expect(text).not.toContain("Clinic AI Assistant"); }
      expect(history).toEqual(originalHistory);
    }
  });

  it("rejects invalid and foreign move targets safely without editing messages", async () => {
    expect(await moveConversationAction(conversationId, "invalid")).toEqual({ error: "Choose a valid room." });
    expect(createClient).not.toHaveBeenCalled();
    const update = vi.fn(() => query(null, { code: "23503", message: "private ownership details" }));
    const from = vi.fn(() => ({ update }));
    createClient.mockResolvedValue({ auth, from });
    expect(await moveConversationAction(conversationId, roomId)).toEqual({ error: "That room is no longer available." });
    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("conversations");
  });
});
