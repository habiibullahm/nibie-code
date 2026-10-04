import { afterEach, describe, expect, it, vi } from "vitest";
const { createClient, provider } = vi.hoisted(() => ({ createClient: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/ai/provider", () => ({ chatProvider: { stream: provider } }));
vi.mock("@/lib/ai/registry", () => ({
  getModelOptions: () => ({ models: [{ id: "Fast" }, { id: "Balanced" }, { id: "High" }] }),
  contextCapabilitiesFor: () => ({ contextWindowTokens: 16384, maxOutputTokens: 2048 }),
  providerFor: () => "openai",
}));
import { POST } from "../../app/api/chat/route";
import { POST as stopRoute } from "../../app/api/chat/stop/route";
import { addUserMessageAction, stopChatResponseAction } from "../../app/actions/chat";
import { readChatSse } from "../../lib/ai/sse";
import { messagePersistenceConfirmed } from "../../lib/chat/recovery";

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const firstUser = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
const secondUser = "11111111-1111-4111-8111-111111111111";
const firstAssistant = "e3b624e6-d792-47a8-8ff2-46724452c1ca";
const secondAssistant = "22222222-2222-4222-8222-222222222222";
type Row = { id: string; conversation_id: string; role: string; content: string; status: string; position: number; reply_to_message_id?: string };
const encoder = new TextEncoder();
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

function database(mode: string, failSave = false, lateClaim = false) {
  const rows: Row[] = [{ id: firstUser, conversation_id: conversation, role: "user", content: "First", status: "complete", position: 1 }];
  const contentGate = deferred(), stopAck = deferred();
  let stoppedContentWrites = 0, stoppedStatusWrites = 0, appendCalls = 0;
  function from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let write: Partial<Row> | undefined, single = false;
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: keyof Row, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: keyof Row, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      update: (value: Partial<Row>) => { write = value; return query; },
      maybeSingle: () => { single = true; return execute(); },
      then: (resolve: (value: unknown) => unknown) => execute().then(resolve),
    };
    async function execute() {
      if (table === "user_preferences") return { data: null, error: null };
      if (table === "conversations") return { data: { id: conversation, selected_model: mode, room_id: null }, error: null };
      if (write?.content !== undefined && filters.some((filter) => filter({ ...rows[0], id: firstAssistant }))) {
        stoppedContentWrites++;
        await contentGate.promise;
        if (failSave) return { data: null, error: { code: "XX000" } };
      }
      const matches = rows.filter((row) => filters.every((filter) => filter(row)));
      if (write) {
        for (const row of matches) Object.assign(row, write);
        if (write.content === undefined && matches.length) { stoppedStatusWrites++; await stopAck.promise; }
      }
      return { data: single ? matches[0] ?? null : [...matches].sort((left, right) => right.position - left.position), error: null };
    }
    return query;
  }
  const rpc = vi.fn((name: string, args: Record<string, string>) => ({ single: async () => {
    if (name === "append_user_message") {
      appendCalls++;
      if (lateClaim) { lateClaim = false; rows.push({ id: firstAssistant, conversation_id: conversation, role: "assistant", content: "…", status: "streaming", position: 2, reply_to_message_id: firstUser }); return { data: null, error: { code: "PT409" } }; }
      const existing = rows.find((row) => row.id === args.p_message_id);
      if (existing) return { data: existing, error: null };
      if (rows.some((row) => row.status === "streaming")) return { data: null, error: { code: "PT409" } };
      const row: Row = { id: args.p_message_id, conversation_id: conversation, role: "user", content: args.p_content, status: "complete", position: Math.max(...rows.map((item) => item.position)) + 1 };
      rows.push(row); return { data: row, error: null };
    }
    const old = rows.find((row) => row.reply_to_message_id === args.p_user_message_id);
    if (old || rows.some((row) => row.status === "streaming")) return { data: null, error: { code: "PT409" } };
    const row: Row = { id: args.p_user_message_id === firstUser ? firstAssistant : secondAssistant, conversation_id: conversation, role: "assistant", content: "…", status: "streaming", position: Math.max(...rows.map((item) => item.position)) + 1, reply_to_message_id: args.p_user_message_id };
    rows.push(row); return { data: { ...row, replayed: false }, error: null };
  } }));
  createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) }, from, rpc });
  return { rows, contentGate, stopAck, rpc, counts: () => ({ stoppedContentWrites, stoppedStatusWrites, appendCalls }) };
}
function request(user: string) { return new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: conversation, userMessageId: user }) }); }
afterEach(() => { vi.restoreAllMocks(); provider.mockReset(); createClient.mockReset(); });

describe("main chat route/action Stop handoff", () => {
  it.each(["Fast", "Balanced", "High"])("starts a new %s request while stopped partial-save and stop acknowledgement are pending", async (mode) => {
    const db = database(mode);
    const cancelled = vi.fn();
    provider.mockResolvedValueOnce(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial first"}}]}\n\n'));
    }, cancel: cancelled })).mockResolvedValueOnce(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Second complete"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); controller.close();
    } }));
    const first = await POST(request(firstUser));
    const reader = first.body!.getReader();
    await reader.read(); await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(db.counts().stoppedContentWrites).toBe(1));
    let acknowledged = false;
    const stop = stopChatResponseAction(conversation, firstUser).then((result) => { acknowledged = true; return result; });
    await vi.waitFor(() => expect(db.rows.find((row) => row.id === firstAssistant)?.status).toBe("interrupted"));
    expect(acknowledged).toBe(false);
    const next = await addUserMessageAction(conversation, "Second", secondUser, [firstUser]);
    expect(next.error).toBeUndefined();
    const second = await POST(request(secondUser));
    expect((await Array.fromAsync(readChatSse(second.body!))).at(-2)).toEqual({ type: "status", status: "complete" });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls.map((call) => call[0])).toEqual([mode, mode]);
    expect(acknowledged).toBe(false);
    expect(db.rows.find((row) => row.id === firstAssistant)?.content).toBe("…");
    db.contentGate.resolve(); db.stopAck.resolve();
    await expect(stop).resolves.toEqual({});
    await vi.waitFor(() => expect(db.rows.find((row) => row.id === firstAssistant)?.content).toBe("Partial first"));
    expect(db.counts()).toEqual({ stoppedContentWrites: 1, stoppedStatusWrites: 1, appendCalls: 1 });
    expect(db.rows.filter((row) => row.role === "assistant")).toHaveLength(2);
    expect(db.rows.find((row) => row.id === firstAssistant)?.status).toBe("interrupted");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("records a stopped-content persistence failure without blocking the next message or overwriting the local partial", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database("Fast", true);
    provider.mockResolvedValue(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Keep partial"}}]}\n\n')); } }));
    const first = await POST(request(firstUser)); const reader = first.body!.getReader();
    await reader.read(); await reader.read(); await reader.cancel();
    const stop = stopChatResponseAction(conversation, firstUser);
    await vi.waitFor(() => expect(db.counts().stoppedStatusWrites).toBe(1));
    expect((await addUserMessageAction(conversation, "Next", secondUser, [firstUser])).error).toBeUndefined();
    db.contentGate.resolve(); db.stopAck.resolve(); await stop;
    await vi.waitFor(() => expect(errors.mock.calls.some(([line]) => String(line).includes("chat.persistence.failed"))).toBe(true));
    expect(db.counts().stoppedContentWrites).toBe(1);
    expect(messagePersistenceConfirmed({ role: "assistant", content: "Keep partial", terminationReason: "user_stopped" }, db.rows.find((row) => row.id === firstAssistant)!)).toBe(false);
  });

  it("retries only the cancelled-claim race, using the same idempotent user message id", async () => {
    const db = database("Fast", false, true); db.stopAck.resolve();
    await expect(addUserMessageAction(conversation, "Next", secondUser, [firstUser])).resolves.toMatchObject({ data: { id: secondUser } });
    expect(db.counts()).toEqual({ stoppedContentWrites: 0, stoppedStatusWrites: 1, appendCalls: 2 });
    expect(db.rows.filter((row) => row.id === secondUser)).toHaveLength(1);
    expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[1][1]);
  });

  it("rejects malformed stop handoffs and RLS-hidden prior messages before appending", async () => {
    createClient.mockReset();
    await expect(addUserMessageAction(conversation, "Next", secondUser, ["bad"])).resolves.toHaveProperty("error");
    await expect(stopChatResponseAction("bad", firstUser)).resolves.toHaveProperty("error");
    expect(createClient).not.toHaveBeenCalled();
    const db = database("Fast");
    await expect(addUserMessageAction(conversation, "Next", secondUser, ["33333333-3333-4333-8333-333333333333"])).resolves.toHaveProperty("error");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("acknowledges Stop through a plain route that retires only the stopped reply", async () => {
    const db = database("Fast");
    db.rows.push({ id: firstAssistant, conversation_id: conversation, role: "assistant", content: "…", status: "streaming", position: 2, reply_to_message_id: firstUser });
    const stop = (body: unknown, headers: Record<string, string> = {}) => stopRoute(new Request("http://localhost/api/chat/stop", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    expect((await stop({ conversationId: conversation, userMessageId: firstUser }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await stopRoute(new Request("http://localhost/api/chat/stop", { method: "POST", body: "{}" }))).status).toBe(415);
    expect(createClient).not.toHaveBeenCalled();
    const invalid = await stop({ conversationId: conversation, userMessageId: "bad" });
    expect(invalid.status).toBe(503);
    await expect(invalid.json()).resolves.toHaveProperty("error");
    expect(db.rows.find((row) => row.id === firstAssistant)?.status).toBe("streaming");
    db.stopAck.resolve();
    const ok = await stop({ conversationId: conversation, userMessageId: firstUser });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({});
    expect(db.rows.find((row) => row.id === firstAssistant)).toMatchObject({ status: "interrupted", content: "…" });
    expect(db.counts()).toEqual({ stoppedContentWrites: 0, stoppedStatusWrites: 1, appendCalls: 0 });
  });

  it("does not replace visible user_stopped text with a status-only acknowledgement", () => {
    const local = { role: "assistant", content: "Partial", terminationReason: "user_stopped" as const };
    expect(messagePersistenceConfirmed(local, { content: "…", status: "interrupted" })).toBe(false);
    expect(messagePersistenceConfirmed(local, { content: "Partial", status: "streaming" })).toBe(false);
    expect(messagePersistenceConfirmed(local, { content: "Partial tail", status: "interrupted" })).toBe(true);
  });
});
