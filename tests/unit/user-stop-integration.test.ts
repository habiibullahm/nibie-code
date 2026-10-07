import { afterEach, describe, expect, it, vi } from "vitest";
const { createClient, provider } = vi.hoisted(() => ({ createClient: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/ai/provider", () => ({ chatProvider: { stream: provider } }));
vi.mock("@/lib/ai/registry", () => ({
  getModelOptions: () => ({ models: [{ id: "Fast" }, { id: "Balanced" }, { id: "High" }] }),
  contextCapabilitiesFor: () => ({ contextWindowTokens: 16384, maxOutputTokens: 2048 }),
  providerFor: () => "openai",
}));
// The generation notices a server-side Stop on its next status check; a short interval keeps these tests fast.
vi.mock("@/lib/chat/stop", async (original) => ({ ...await original<typeof import("../../lib/chat/stop")>(), stopPollMs: 5 }));
import { POST } from "../../app/api/chat/route";
import { POST as stopRoute } from "../../app/api/chat/stop/route";
import { addUserMessageAction, stopChatResponseAction } from "../../app/actions/chat";
import { readChatSse, type ChatStreamEvent } from "../../lib/ai/sse";
import { messagePersistenceConfirmed } from "../../lib/chat/recovery";
import { stopDecision, stoppedContent } from "../../lib/chat/stop";

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const firstUser = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
const secondUser = "11111111-1111-4111-8111-111111111111";
const firstAssistant = "e3b624e6-d792-47a8-8ff2-46724452c1ca";
const secondAssistant = "22222222-2222-4222-8222-222222222222";
type Row = { id: string; conversation_id: string; role: string; content: string; status: string; position: number; reply_to_message_id?: string };
const encoder = new TextEncoder();
const delta = (text: string) => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
const finish = encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');

// A small owner-scoped messages table with the claim/append rules of 0001_chat_generation_safety.sql.
function database(mode: string, options: { lateClaim?: boolean; failStopWrite?: boolean } = {}) {
  const rows: Row[] = [{ id: firstUser, conversation_id: conversation, role: "user", content: "First", status: "complete", position: 1 }];
  const writes: { id?: string; write: Partial<Row>; applied: number }[] = [];
  let appendCalls = 0, creditsUsed = 0; let lateClaim = options.lateClaim ?? false;
  const weights: Record<string, number> = { Fast: 1, Balanced: 3, High: 6 };
  function from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let write: Partial<Row> | undefined;
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: keyof Row, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: keyof Row, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      update: (value: Partial<Row>) => { write = value; return query; },
      maybeSingle: () => execute(true),
      then: (resolve: (value: unknown) => unknown) => execute(false).then(resolve),
    };
    async function execute(single: boolean) {
      if (table === "user_preferences") return { data: null, error: null };
      if (table === "message_attachments") return { data: [], error: null };
      if (table === "conversations") return { data: { id: conversation, selected_model: mode, room_id: null }, error: null };
      const matches = rows.filter((row) => filters.every((filter) => filter(row)));
      if (write) {
        if (options.failStopWrite && write.status === "interrupted" && write.content !== undefined && matches.some((row) => row.status === "streaming")) return { data: null, error: { code: "XX000" } };
        for (const row of matches) Object.assign(row, write);
        writes.push({ id: matches[0]?.id, write, applied: matches.length });
      }
      const data = matches.map((row) => ({ ...row }));
      return { data: single ? data[0] ?? null : data.sort((left, right) => right.position - left.position), error: null };
    }
    return query;
  }
  const rpc = vi.fn((name: string, args: Record<string, string>) => {
    const run = async () => {
      if (name === "reserve_weekly_ai_usage") {
        const cost = weights[args.p_logical_mode] ?? 0; creditsUsed += cost;
        return { data: { accepted: true, credits_charged: cost, credits_used: creditsUsed, credits_remaining: 500 - creditsUsed, reset_at: "2026-10-05T00:00:00.000Z" }, error: null };
      }
      if (name === "start_weekly_ai_usage") return { data: true, error: null };
      if (name === "release_weekly_ai_usage") { creditsUsed = Math.max(0, creditsUsed - (weights[mode] ?? 0)); return { data: true, error: null }; }
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
      if (old?.status === "complete") return { data: { ...old, replayed: true }, error: null };
      if (rows.some((row) => row.status === "streaming")) return { data: null, error: { code: "PT409" } };
      if (old) rows.splice(rows.indexOf(old), 1);
      const id = args.p_user_message_id === firstUser ? old ? "44444444-4444-4444-8444-444444444444" : firstAssistant : secondAssistant;
      const row: Row = { id, conversation_id: conversation, role: "assistant", content: "…", status: "streaming", position: old?.position ?? Math.max(...rows.map((item) => item.position)) + 1, reply_to_message_id: args.p_user_message_id };
      rows.push(row); return { data: { ...row, replayed: false }, error: null };
    };
    return { single: run, then: (resolve: (value: unknown) => unknown) => run().then(resolve) };
  });
  createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) }, from, rpc });
  const reply = (id = firstAssistant) => rows.find((row) => row.id === id);
  const contentWrites = (id = firstAssistant) => writes.filter((entry) => entry.id === id && entry.applied && entry.write.content !== undefined);
  return { rows, writes, rpc, reply, contentWrites, appendCalls: () => appendCalls, usage: () => creditsUsed };
}

// A provider stream that sends `parts`, then stays open (a long High reply still being written) until it is cancelled or released.
function openProvider(parts: string[]) {
  let release!: () => void;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(delta(part));
      release = () => { try { controller.enqueue(delta(" and the rest of a complete answer.")); controller.enqueue(finish); controller.close(); } catch { /* already cancelled */ } };
    },
    cancel: cancelled,
  });
  return { body, cancelled, release: () => release() };
}
function completeProvider(text: string) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(delta(text)); controller.enqueue(finish); controller.close(); } });
}
// The hosted case from issue #12: the browser has gone, but nothing ever aborts request.signal.
function request(user: string, regenerate = false) {
  return new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: conversation, userMessageId: user, ...(regenerate ? { regenerate } : {}) }) });
}
// Reads events until `until` matches, leaving the rest of the stream to `rest()`.
async function readUntil(response: Response, until: (event: ChatStreamEvent) => boolean) {
  const events: ChatStreamEvent[] = [];
  const iterator = readChatSse(response.body!)[Symbol.asyncIterator]();
  for (;;) {
    const next = await iterator.next();
    if (next.done) return { events, rest: async () => events };
    events.push(next.value);
    if (until(next.value)) break;
  }
  return { events, rest: async () => { for (let next = await iterator.next(); !next.done; next = await iterator.next()) events.push(next.value); return events; } };
}
const shown = (events: ChatStreamEvent[]) => events.flatMap((event) => event.type === "delta" ? [event.text] : []).join("");
afterEach(() => { vi.restoreAllMocks(); provider.mockReset(); createClient.mockReset(); });

describe("server-authoritative Stop (issue #12)", () => {
  it.each(["Fast", "Balanced", "High"])("%s: Stop reaches the running generation, aborts the provider and keeps exactly the text shown", async (mode) => {
    const db = database(mode);
    const upstream = openProvider(["Partial ", "first"]);
    provider.mockResolvedValueOnce(upstream.body);
    const live = await readUntil(await POST(request(firstUser)), (event) => event.type === "delta" && event.text === "first");
    const visible = shown(live.events);
    expect(visible).toBe("Partial first");

    await expect(stopChatResponseAction(conversation, firstUser, firstAssistant, visible)).resolves.toEqual({});
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Partial first" });
    // 1-2. The generation sees the stopped row and stops the provider itself; request.signal never aborted.
    await vi.waitFor(() => expect(upstream.cancelled).toHaveBeenCalledOnce());
    expect(provider.mock.calls[0][0]).toBe(mode);
    expect((provider.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
    expect(db.usage()).toBe(({ Fast: 1, Balanced: 3, High: 6 } as const)[mode as "Fast" | "Balanced" | "High"]);
    const events = await live.rest();
    expect(events.slice(-2)).toEqual([{ type: "status", status: "interrupted" }, { type: "done" }]);
    // 3-4. The exact partial, as interrupted; the generation never wrote its own content over it.
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Partial first" });
    expect(db.contentWrites()).toHaveLength(1);
  });

  it("keeps what the user saw even when the server had produced more by the time Stop landed", async () => {
    const db = database("High");
    const upstream = openProvider(["Seen text", " that never reached the screen"]);
    provider.mockResolvedValueOnce(upstream.body);
    const live = await readUntil(await POST(request(firstUser)), (event) => event.type === "delta");
    await stopChatResponseAction(conversation, firstUser, firstAssistant, shown(live.events));
    await live.rest();
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Seen text" });
  });

  it("5/9. a generation that finishes after Stop cannot complete or overwrite the stopped reply", async () => {
    const db = database("High");
    const upstream = openProvider(["Half an answer"]);
    provider.mockResolvedValueOnce(upstream.body);
    const live = await readUntil(await POST(request(firstUser)), (event) => event.type === "delta");
    await stopChatResponseAction(conversation, firstUser, firstAssistant, "Half an answer");
    upstream.release(); // the provider finishes before the generation's next status check
    const events = await live.rest();
    expect(events).not.toContainEqual({ type: "status", status: "complete" });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Half an answer" });
    expect(db.contentWrites()).toHaveLength(1);
    // Retrying the same message starts a fresh reply: no completed answer was ever saved to replay.
    provider.mockResolvedValueOnce(completeProvider("Fresh answer"));
    const retry = await Array.fromAsync(readChatSse((await POST(request(firstUser, true))).body!));
    expect(shown(retry)).toBe("Fresh answer");
  });

  it("5. a Stop that lands after the generation saved its completed answer still leaves the reply stopped", async () => {
    const db = database("High");
    provider.mockResolvedValueOnce(completeProvider("Complete answer with more words"));
    await Array.fromAsync(readChatSse((await POST(request(firstUser))).body!));
    expect(db.reply()).toMatchObject({ status: "complete", content: "Complete answer with more words" });
    // The user pressed Stop while "Complete answer" was on screen; the completion was still on its way to the browser.
    await expect(stopChatResponseAction(conversation, firstUser, firstAssistant, "Complete answer")).resolves.toEqual({});
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Complete answer" });
    // A reload reads the same row: never the completed answer.
    expect(messagePersistenceConfirmed({ role: "assistant", content: "Complete answer", terminationReason: "user_stopped" }, db.reply()!)).toBe(true);
  });

  it("6. Stop before any text keeps a readable notice, never the claim placeholder", async () => {
    const db = database("High");
    const upstream = openProvider([]);
    provider.mockResolvedValueOnce(upstream.body);
    const live = await readUntil(await POST(request(firstUser)), (event) => event.type === "start");
    expect(db.reply()?.content).toBe("…");
    await stopChatResponseAction(conversation, firstUser, firstAssistant, "");
    await live.rest();
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Response stopped." });
    expect(db.rows.some((row) => row.content === "…")).toBe(false);
  });

  it("7. repeated Stop is idempotent and a Stop can never put different words in a reply", async () => {
    const db = database("Balanced");
    const upstream = openProvider(["Stopped here"]);
    provider.mockResolvedValueOnce(upstream.body);
    const live = await readUntil(await POST(request(firstUser)), (event) => event.type === "delta");
    for (let index = 0; index < 3; index++) await expect(stopChatResponseAction(conversation, firstUser, firstAssistant, "Stopped here")).resolves.toEqual({});
    await expect(stopChatResponseAction(conversation, firstUser, firstAssistant, "Something else entirely")).resolves.toEqual({});
    await live.rest();
    expect(db.contentWrites()).toHaveLength(1);
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Stopped here" });
  });

  it.each(["Fast", "Balanced", "High"])("8. %s: Stop then an immediate Send works before the Stop acknowledgement arrives", async (mode) => {
    const db = database(mode);
    const upstream = openProvider(["Partial first"]);
    provider.mockResolvedValueOnce(upstream.body).mockResolvedValueOnce(completeProvider("Second complete"));
    const live = await readUntil(await POST(request(firstUser)), (event) => event.type === "delta");
    // The next message carries the Stop, so it does not depend on the background acknowledgement.
    const stop = { userMessageId: firstUser, assistantId: firstAssistant, content: "Partial first" };
    await expect(addUserMessageAction(conversation, "Second", secondUser, [stop])).resolves.toMatchObject({ data: { id: secondUser } });
    const second = await Array.fromAsync(readChatSse((await POST(request(secondUser))).body!));
    expect(second.slice(-2)).toEqual([{ type: "status", status: "complete" }, { type: "done" }]);
    // The acknowledgement lands late and changes nothing.
    await expect(stopChatResponseAction(conversation, firstUser, firstAssistant, "Partial first")).resolves.toEqual({});
    await live.rest();
    await vi.waitFor(() => expect(upstream.cancelled).toHaveBeenCalledOnce());
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Partial first" });
    expect(db.reply(secondAssistant)).toMatchObject({ status: "complete", content: "Second complete" });
    expect(db.contentWrites()).toHaveLength(1);
    expect(provider.mock.calls.map((call) => call[0])).toEqual([mode, mode]);
  });

  it("a browser disconnect without Stop still saves the generation's partial as interrupted", async () => {
    const db = database("High");
    const upstream = openProvider(["Kept on disconnect"]);
    provider.mockResolvedValueOnce(upstream.body);
    const reader = (await POST(request(firstUser))).body!.getReader();
    await reader.read(); await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(db.reply()).toMatchObject({ status: "interrupted", content: "Kept on disconnect" }));
    // A Stop that follows the disconnect cuts it back to exactly what was on screen.
    await stopChatResponseAction(conversation, firstUser, firstAssistant, "Kept on");
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Kept on" });
  });

  it("a late Stop for an earlier reply never reaches a newer reply to the same message", async () => {
    const db = database("Fast");
    db.rows.push({ id: firstAssistant, conversation_id: conversation, role: "assistant", content: "Old partial", status: "interrupted", position: 2, reply_to_message_id: firstUser });
    const upstream = openProvider(["New attempt"]);
    provider.mockResolvedValueOnce(upstream.body);
    const live = await readUntil(await POST(request(firstUser, true)), (event) => event.type === "delta");
    const retried = db.rows.find((row) => row.role === "assistant")!;
    expect(retried).toMatchObject({ status: "streaming", content: "…" });
    await expect(stopChatResponseAction(conversation, firstUser, firstAssistant, "Old")).resolves.toEqual({});
    expect(retried.status).toBe("streaming");
    upstream.release();
    await live.rest();
    expect(retried).toMatchObject({ status: "complete", content: "New attempt and the rest of a complete answer." });
  });

  it("reports a Stop that could not be saved without blocking the next message", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    database("Fast", { failStopWrite: true });
    const upstream = openProvider(["Keep partial"]);
    provider.mockResolvedValueOnce(upstream.body);
    const live = await readUntil(await POST(request(firstUser)), (event) => event.type === "delta");
    await expect(stopChatResponseAction(conversation, firstUser, firstAssistant, "Keep partial")).resolves.toHaveProperty("error");
    expect(errors.mock.calls.some(([line]) => String(line).includes("chat.persistence.failed"))).toBe(true);
    upstream.release();
    await live.rest();
  });

  it("retries only the cancelled-claim race, using the same idempotent user message id", async () => {
    const db = database("Fast", { lateClaim: true });
    await expect(addUserMessageAction(conversation, "Next", secondUser, [firstUser])).resolves.toMatchObject({ data: { id: secondUser } });
    expect(db.appendCalls()).toBe(2);
    expect(db.rows.filter((row) => row.id === secondUser)).toHaveLength(1);
    expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[1][1]);
    // The claim that never reached the screen is stopped with a readable notice, not the placeholder.
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Response stopped." });
  });

  it("rejects malformed stop handoffs and RLS-hidden prior messages before appending", async () => {
    createClient.mockReset();
    await expect(addUserMessageAction(conversation, "Next", secondUser, ["bad"])).resolves.toHaveProperty("error");
    await expect(addUserMessageAction(conversation, "Next", secondUser, [{ userMessageId: firstUser, content: 42 }])).resolves.toHaveProperty("error");
    await expect(addUserMessageAction(conversation, "Next", secondUser, [{ userMessageId: firstUser, content: "x".repeat(100_001) }])).resolves.toHaveProperty("error");
    await expect(stopChatResponseAction("bad", firstUser)).resolves.toHaveProperty("error");
    await expect(stopChatResponseAction(conversation, firstUser, "bad", "text")).resolves.toHaveProperty("error");
    expect(createClient).not.toHaveBeenCalled();
    const db = database("Fast");
    await expect(addUserMessageAction(conversation, "Next", secondUser, ["33333333-3333-4333-8333-333333333333"])).resolves.toHaveProperty("error");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("acknowledges Stop through a plain route that saves the shown text on the stopped reply only", async () => {
    const db = database("Fast");
    db.rows.push({ id: firstAssistant, conversation_id: conversation, role: "assistant", content: "…", status: "streaming", position: 2, reply_to_message_id: firstUser });
    const stop = (body: unknown, headers: Record<string, string> = {}) => stopRoute(new Request("http://localhost/api/chat/stop", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    expect((await stop({ conversationId: conversation, userMessageId: firstUser }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await stopRoute(new Request("http://localhost/api/chat/stop", { method: "POST", body: "{}" }))).status).toBe(415);
    expect(createClient).not.toHaveBeenCalled();
    const invalid = await stop({ conversationId: conversation, userMessageId: "bad" });
    expect(invalid.status).toBe(503);
    await expect(invalid.json()).resolves.toHaveProperty("error");
    expect(db.reply()?.status).toBe("streaming");
    const ok = await stop({ conversationId: conversation, userMessageId: firstUser, assistantId: firstAssistant, content: "Shown text" });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({});
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Shown text" });
    expect(db.rows.find((row) => row.id === firstUser)).toMatchObject({ status: "complete", content: "First" });
  });

  it("an older client's status-only Stop still never leaves the claim placeholder", async () => {
    const db = database("Fast");
    db.rows.push({ id: firstAssistant, conversation_id: conversation, role: "assistant", content: "…", status: "streaming", position: 2, reply_to_message_id: firstUser });
    await expect(stopChatResponseAction(conversation, firstUser)).resolves.toEqual({});
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Response stopped." });
    // A later Stop with the shown text replaces the notice; a completed reply is never touched by a status-only Stop.
    await stopChatResponseAction(conversation, firstUser, firstAssistant, "Shown");
    expect(db.reply()).toMatchObject({ status: "interrupted", content: "Shown" });
    db.reply()!.status = "complete";
    await stopChatResponseAction(conversation, firstUser);
    expect(db.reply()?.status).toBe("complete");
  });
});

describe("Stop rules", () => {
  it("decides when a Stop may write a reply", () => {
    expect(stopDecision({ status: "streaming", content: "…" }, "Any")).toBe("write");
    expect(stopDecision({ status: "streaming", content: "…" }, null)).toBe("write");
    expect(stopDecision({ status: "complete", content: "Full answer" }, "Full")).toBe("write");
    expect(stopDecision({ status: "complete", content: "Full answer" }, "Other")).toBe("skip");
    expect(stopDecision({ status: "complete", content: "Full answer" }, null)).toBe("skip");
    expect(stopDecision({ status: "interrupted", content: "Full" }, "Full")).toBe("done");
    expect(stopDecision({ status: "interrupted", content: "Response stopped." }, "Seen")).toBe("write");
    expect(stopDecision({ status: "interrupted", content: "…" }, "")).toBe("write");
    // A provider failure racing the Stop: the user's Stop wins, still only with the words they saw.
    expect(stopDecision({ status: "error", content: "Response unavailable." }, "Seen")).toBe("write");
    expect(stopDecision({ status: "error", content: "Seen and more" }, "Seen")).toBe("write");
    expect(stopDecision({ status: "error", content: "Seen and more" }, "Other")).toBe("skip");
    expect(stopDecision({ status: "error", content: "Response unavailable." }, null)).toBe("skip");
    expect(stoppedContent("")).toBe("Response stopped.");
    expect(stoppedContent("  \n")).toBe("Response stopped.");
    expect(stoppedContent("…")).toBe("Response stopped.");
    expect(stoppedContent("Partial")).toBe("Partial");
  });

  it("only confirms a stopped reply when the server holds it stopped with exactly the text on screen", () => {
    const local = { role: "assistant", content: "Partial", terminationReason: "user_stopped" as const };
    expect(messagePersistenceConfirmed(local, { content: "…", status: "interrupted" })).toBe(false);
    expect(messagePersistenceConfirmed(local, { content: "Partial", status: "streaming" })).toBe(false);
    // The issue's bug: a completed answer that starts with the partial replaced the stopped reply.
    expect(messagePersistenceConfirmed(local, { content: "Partial and the finished rest", status: "complete" })).toBe(false);
    expect(messagePersistenceConfirmed(local, { content: "Partial tail", status: "interrupted" })).toBe(false);
    expect(messagePersistenceConfirmed(local, { content: "Partial", status: "interrupted" })).toBe(true);
  });
});
