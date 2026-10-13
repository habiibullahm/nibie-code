import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, createActionAuditClient } = vi.hoisted(() => ({ createClient: vi.fn(), createActionAuditClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/supabase/service-role", () => ({ createActionAuditClient }));
vi.mock("@/lib/ai/registry", () => ({ getModelOptions: () => ({ models: [{ id: "Balanced", label: "Balanced", description: "" }] }) }));

import { discardTemporaryConversationAction, startConversationAction } from "../../app/actions/chat";
import { POST as purge } from "../../app/api/cron/purge-temporary-chats/route";
import { getChatWorkspaceData } from "../../lib/chat/read";
import { searchOwnedChats, type ChatSearchDb } from "../../lib/chat/search-owned";
import { isExpiredTemporaryConversation, isTemporaryConversation, TEMPORARY_CHAT_TTL_MS, temporaryChatExpiry } from "../../lib/chat/temporary";
import { recallOperationInstruction, TEMPORARY_CHAT_INSTRUCTION } from "../../lib/context/recall-context";

const auth = { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) };
const conversationId = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const messageId = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
const roomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const stamp = "2026-10-04T00:00:00.000Z";
const later = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

// A chainable query that records every filter and resolves to `result`.
function recorded(result: { data: unknown; error: unknown }, calls: unknown[][] = []) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "lt", "is", "in", "ilike", "order", "limit", "delete", "insert"]) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

describe("temporary chat expiry", () => {
  it("expires a fixed time after it starts", () => {
    expect(Date.parse(temporaryChatExpiry(0))).toBe(TEMPORARY_CHAT_TTL_MS);
    expect(TEMPORARY_CHAT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("tells temporary, live and expired chats apart", () => {
    const now = Date.parse(stamp);
    expect(isTemporaryConversation({ temporary_expires_at: null })).toBe(false);
    expect(isTemporaryConversation({})).toBe(false);
    expect(isTemporaryConversation({ temporary_expires_at: "2026-10-05T00:00:00.000Z" })).toBe(true);
    expect(isExpiredTemporaryConversation({ temporary_expires_at: "2026-10-05T00:00:00.000Z" }, now)).toBe(false);
    expect(isExpiredTemporaryConversation({ temporary_expires_at: "2026-10-03T00:00:00.000Z" }, now)).toBe(true);
    expect(isExpiredTemporaryConversation({ temporary_expires_at: "not a date" }, now)).toBe(true);
    expect(isExpiredTemporaryConversation({ temporary_expires_at: null }, now)).toBe(false);
  });

  it("gives the model a standing temporary-chat instruction", () => {
    expect(recallOperationInstruction("temporary_chat")).toBe(TEMPORARY_CHAT_INSTRUCTION);
    expect(TEMPORARY_CHAT_INSTRUCTION).toContain("Do not claim you saved, forgot or recalled anything.");
  });
});

describe("starting and leaving a temporary chat", () => {
  beforeEach(() => createClient.mockReset());

  it("creates a General chat marked with an expiry, after sweeping the owner's expired ones", async () => {
    const calls: unknown[][] = [];
    const inserted: Record<string, unknown>[] = [];
    const conversations = {
      ...recorded({ data: null, error: null }, calls),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return recorded({ data: { id: conversationId, title: "Temporary chat", selected_model: "Balanced", room_id: null, temporary_expires_at: row.temporary_expires_at, created_at: stamp, updated_at: stamp }, error: null });
      },
    };
    const rpc = vi.fn(() => ({ single: async () => ({ data: { id: messageId, position: 1 }, error: null }) }));
    createClient.mockResolvedValue({ auth, rpc, from: () => conversations });
    const before = Date.now();
    const result = await startConversationAction("Balanced", messageId, "hello", null, undefined, true);
    expect(result.error).toBeUndefined();
    expect(result.data?.conversation.temporary_expires_at).toBeTruthy();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).not.toHaveProperty("room_id");
    expect(Date.parse(inserted[0].temporary_expires_at as string)).toBeGreaterThanOrEqual(before + TEMPORARY_CHAT_TTL_MS);
    expect(calls).toContainEqual(["delete"]);
    expect(calls.some(([method, column]) => method === "lt" && column === "temporary_expires_at")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("append_user_message", { p_conversation_id: conversationId, p_message_id: messageId, p_content: "hello" });
  });

  it("refuses a Room or a malformed flag before opening a client", async () => {
    await expect(startConversationAction("Balanced", messageId, "hello", roomId, undefined, true)).resolves.toEqual({ error: "Temporary chats can't be started in a room." });
    await expect(startConversationAction("Balanced", messageId, "hello", null, undefined, "yes")).resolves.toEqual({ error: "Choose a valid chat type." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("never falls back to an ordinary chat when the database has no temporary chats yet", async () => {
    const inserted: unknown[] = [];
    const conversations = {
      ...recorded({ data: null, error: null }),
      insert: (row: unknown) => { inserted.push(row); return recorded({ data: null, error: { code: "42703", message: "column does not exist" } }); },
    };
    createClient.mockResolvedValue({ auth, rpc: vi.fn(), from: () => conversations });
    await expect(startConversationAction("Balanced", messageId, "hello", null, undefined, true)).resolves.toEqual({ error: "Temporary chats aren't available yet." });
    expect(inserted).toHaveLength(1);
  });

  it("deletes only a temporary chat when its owner leaves it", async () => {
    const calls: unknown[][] = [];
    createClient.mockResolvedValue({ auth, from: () => recorded({ data: null, error: null }, calls) });
    await expect(discardTemporaryConversationAction(conversationId)).resolves.toEqual({});
    expect(calls).toEqual([["delete"], ["eq", "id", conversationId], ["not", "temporary_expires_at", "is", null]]);
    await expect(discardTemporaryConversationAction("not-an-id")).resolves.toEqual({ error: "Choose a valid conversation." });
  });
});

describe("the workspace never lists a temporary chat", () => {
  beforeEach(() => createClient.mockReset());
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({ id, title: id, selected_model: "Balanced", room_id: null, archived_at: null, temporary_expires_at: null, created_at: stamp, updated_at: stamp, ...overrides });
  const client = (conversations: unknown[]) => ({ from: (table: string) => recorded({ data: table === "conversations" ? conversations : [], error: null }) });

  it("keeps temporary chats out of history and the archive, and opens only the requested live one", async () => {
    const live = "11111111-1111-4111-8111-111111111111";
    createClient.mockResolvedValue(client([row("ordinary"), row("archived", { archived_at: stamp }), row(live, { temporary_expires_at: later() }), row("other-temporary", { temporary_expires_at: later() })]));
    const data = await getChatWorkspaceData(live);
    expect(data.conversations.map((item) => item.id)).toEqual(["ordinary"]);
    expect(data.archivedConversations.map((item) => item.id)).toEqual(["archived"]);
    expect(data.temporaryConversation?.id).toBe(live);
    expect(data.activeId).toBe(live);
  });

  it("treats an expired temporary chat as gone", async () => {
    const expired = "22222222-2222-4222-8222-222222222222";
    createClient.mockResolvedValue(client([row("ordinary"), row(expired, { temporary_expires_at: "2026-01-01T00:00:00.000Z" })]));
    const data = await getChatWorkspaceData(expired);
    expect(data.temporaryConversation).toBeNull();
    expect(data.activeId).toBeNull();
    expect(data.conversations.map((item) => item.id)).toEqual(["ordinary"]);
  });
});

describe("chat search never finds a temporary chat", () => {
  it("drops temporary titles and their messages", async () => {
    const conversationsResult = { data: [
      { id: "ordinary", title: "Tea notes", room_id: null, archived_at: null, temporary_expires_at: null },
      { id: "temporary", title: "Tea secrets", room_id: null, archived_at: null, temporary_expires_at: later() },
    ], error: null };
    const messagesResult = { data: [{ id: "m1", conversation_id: "temporary", role: "user", content: "tea in a temporary chat", created_at: stamp }], error: null };
    const supabase = { from: (table: string) => recorded(table === "messages" ? messagesResult : table === "rooms" ? { data: [], error: null } : conversationsResult) } as unknown as ChatSearchDb;
    const result = await searchOwnedChats(supabase, "tea");
    expect(result.ok).toBe(true);
    const ids = result.ok ? [...result.data.conversations, ...result.data.messages].map((hit) => hit.conversationId) : [];
    expect(ids).toEqual(["ordinary"]);
  });
});

describe("expired temporary chat cleanup", () => {
  beforeEach(() => { createActionAuditClient.mockReset(); delete process.env.CRON_SECRET; vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined); });
  const request = (token?: string) => new Request("http://localhost/api/cron/purge-temporary-chats", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("requires the cron secret", async () => {
    expect((await purge(request("x"))).status).toBe(503);
    process.env.CRON_SECRET = "expected-secret";
    expect((await purge(request())).status).toBe(401);
    expect((await purge(request("wrong"))).status).toBe(401);
    expect(createActionAuditClient).not.toHaveBeenCalled();
  });

  it("deletes only expired temporary chats with the service-role client", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const calls: unknown[][] = [];
    createActionAuditClient.mockReturnValue({ from: (table: string) => { calls.push(["from", table]); return recorded({ data: [{ id: "a" }, { id: "b" }], error: null }, calls); } });
    const response = await purge(request("expected-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deleted: 2 });
    expect(calls[0]).toEqual(["from", "conversations"]);
    expect(calls[1]).toEqual(["delete"]);
    expect(calls[2][0]).toBe("lt");
    expect(calls[2][1]).toBe("temporary_expires_at");
  });
});
