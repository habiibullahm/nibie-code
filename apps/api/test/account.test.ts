import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { accountExportSchema, buildConversationExport } from "@nibie/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, expectUuid, validEnv } from "./fixture.js";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

type Row = Record<string, unknown> & { id: string };
type TableName = "conversations" | "messages" | "user_preferences" | "users";
type Store = Record<TableName, Row[]>;
type DbError = { code: string; message: string };

type ClientCall = {
  url: string;
  key: string;
  authorization: string | undefined;
  persistSession: boolean | undefined;
  autoRefreshToken: boolean | undefined;
  detectSessionInUrl: boolean | undefined;
};

type Operation = {
  token: string;
  table: string;
  op: string;
  columns?: string;
  column?: string;
  value?: string;
  from?: number;
  to?: number;
  filters?: Array<[string, string]>;
  orders?: string[];
};

type SignOutCall = { token: string; jwt: string; scope: string };

const sessions = new Map<string, string>();
const rows = new Map<string, Store>();
const operations: Operation[] = [];
const signOuts: SignOutCall[] = [];
const clientCalls: ClientCall[] = [];
let forcedError: DbError | null = null;
let forcedErrorTable: string | null = null;
let signOutError: { status?: number; message?: string } | null = null;
let signOutThrown: Error | null = null;
let repeatFullPage = false;

const verifyToken = vi.fn(async (token: string) => {
  const sub = sessions.get(token);
  return sub ? { sub } : null;
});

const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";

function conversation(overrides: Record<string, unknown> = {}): Row {
  return {
    id: conversationId,
    title: "Mine",
    selected_model: "Fast",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-02T00:00:00.000Z",
    user_id: "user-123",
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}): Row {
  return {
    id: messageId,
    conversation_id: conversationId,
    role: "user",
    content: "only mine",
    status: "complete",
    position: 1,
    created_at: "2026-03-01T00:00:01.000Z",
    reply_to_message_id: null,
    user_id: "user-123",
    ...overrides,
  };
}

function emptyStore(): Store {
  return { conversations: [], messages: [], user_preferences: [], users: [] };
}

function seed(token: string, patch: Partial<Store>) {
  rows.set(token, { ...emptyStore(), ...patch });
}

function bearerFrom(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return "";
  return authorization.slice("Bearer ".length);
}

function matching(token: string, table: string, filters: Array<[string, string]>) {
  const tableRows = rows.get(token)?.[table as TableName] ?? [];
  return tableRows.filter((row) => filters.every(([column, value]) => String(row[column]) === value));
}

function errorFor(table: string) {
  if (!forcedError) return null;
  if (forcedErrorTable && forcedErrorTable !== table) return null;
  return forcedError;
}

function installClient(token: string) {
  return {
    auth: {
      admin: {
        signOut: async (jwt: string, scope: string) => {
          signOuts.push({ token, jwt, scope });
          if (signOutThrown) throw signOutThrown;
          return { data: null, error: signOutError };
        },
      },
    },
    from(table: string) {
      operations.push({ token, table, op: "from" });
      const state = { filters: [] as Array<[string, string]>, orders: [] as string[], deleting: false, columns: "" };
      const api = {
        select(columns: string) {
          state.columns = columns;
          operations.push({ token, table, op: "select", columns, filters: [...state.filters] });
          if (!state.deleting) return api;
          operations.push({ token, table, op: "delete-result", columns, filters: [...state.filters] });
          const failure = errorFor(table);
          if (failure) return Promise.resolve({ data: null, error: failure });
          const matched = matching(token, table, state.filters);
          const store = rows.get(token);
          if (store) {
            store[table as TableName] = store[table as TableName].filter((row) => !matched.includes(row));
          }
          return Promise.resolve({ data: matched.map((row) => ({ id: row.id })), error: null });
        },
        delete() {
          state.deleting = true;
          operations.push({ token, table, op: "delete" });
          return api;
        },
        eq(column: string, value: string) {
          state.filters.push([column, value]);
          operations.push({ token, table, op: "eq", column, value });
          return api;
        },
        order(column: string, options?: { ascending?: boolean }) {
          state.orders.push(column);
          operations.push({ token, table, op: "order", column, value: String(options?.ascending) });
          return api;
        },
        range(from: number, to: number) {
          operations.push({
            token,
            table,
            op: "range",
            from,
            to,
            columns: state.columns,
            filters: [...state.filters],
            orders: [...state.orders],
          });
          const failure = errorFor(table);
          if (failure) return Promise.resolve({ data: null, error: failure });
          const matched = matching(token, table, state.filters);
          const page = repeatFullPage ? matched.slice(0, 1000) : matched.slice(from, to + 1);
          return Promise.resolve({ data: page, error: null });
        },
      };
      return api;
    },
  };
}

function source(relative: string) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function bearer(token = "valid-token", extra?: Record<string, string>) {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function buildAccountApp(env: Record<string, string | undefined> = validEnv, logStream?: Writable) {
  return buildTestApp(env, verifyToken, logStream ? { logStream } : undefined);
}

beforeEach(() => {
  sessions.clear();
  rows.clear();
  operations.length = 0;
  signOuts.length = 0;
  clientCalls.length = 0;
  forcedError = null;
  forcedErrorTable = null;
  signOutError = null;
  signOutThrown = null;
  repeatFullPage = false;
  sessions.set("valid-token", "user-123");
  verifyToken.mockClear();
  createClientMock.mockReset();
  createClientMock.mockImplementation((url: string, key: string, options: {
    auth?: { persistSession?: boolean; autoRefreshToken?: boolean; detectSessionInUrl?: boolean };
    global?: { headers?: { Authorization?: string } };
  }) => {
    const authorization = options?.global?.headers?.Authorization;
    clientCalls.push({
      url,
      key,
      authorization,
      persistSession: options?.auth?.persistSession,
      autoRefreshToken: options?.auth?.autoRefreshToken,
      detectSessionInUrl: options?.auth?.detectSessionInUrl,
    });
    return installClient(bearerFrom(authorization));
  });
});

describe("account contract", () => {
  it("parses the export builder output and drops owner and secret fields", () => {
    const payload = buildConversationExport({
      conversations: [{ ...conversation(), api_key: "sk-live" } as never],
      messages: [{ ...message(), provider: "secret-provider" } as never],
      exportedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(accountExportSchema.parse(payload)).toEqual(payload);
    expect(JSON.stringify(payload)).not.toContain("sk-live");
    expect(JSON.stringify(payload)).not.toContain("user_id");
    expect(JSON.stringify(payload)).not.toContain("secret-provider");
  });
});

describe("account auth", () => {
  it("rejects export, delete-all, and sign-out without a bearer token", async () => {
    const app = await buildAccountApp();
    const exported = await app.inject({ method: "GET", url: "/v1/account/export" });
    const deleted = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      payload: { confirmation: "DELETE" },
    });
    const signedOut = await app.inject({ method: "POST", url: "/v1/auth/sign-out", payload: {} });

    expect(exported.statusCode).toBe(401);
    expect(deleted.statusCode).toBe(401);
    expect(signedOut.statusCode).toBe(401);
    expect(exported.json().error.code).toBe("unauthorized");
    expect(deleted.json().error.message).toBe("Authentication required.");
    expect(exported.json().error.requestId).toBe(exported.headers["x-request-id"]);
    expect(verifyToken).not.toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(operations).toEqual([]);
    expect(signOuts).toEqual([]);
    await app.close();
  });

  it("rejects a malformed or invalid bearer token before any account call", async () => {
    const app = await buildAccountApp();
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { authorization: "Token valid-token" },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: { authorization: "Bearer wrong-token extra" },
      payload: {},
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: { authorization: "Bearer wrong-token" },
      payload: { confirmation: "DELETE" },
    });

    expect(malformed.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(rejected.statusCode).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(operations).toEqual([]);
    expect(signOuts).toEqual([]);
    await app.close();
  });

  it("builds one request-scoped user client from the verified bearer and ignores other tokens", async () => {
    seed("valid-token", { conversations: [], messages: [] });
    const app = await buildAccountApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: bearer("valid-token", { "x-access-token": "attacker-token", "x-user-id": "attacker-id" }),
      payload: { jwt: "attacker-token", accessToken: "attacker-token", user_id: "attacker-id" },
    });

    expect(response.statusCode).toBe(200);
    expect(verifyToken).toHaveBeenCalledTimes(1);
    expect(verifyToken).toHaveBeenCalledWith("valid-token");
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(clientCalls[0]).toMatchObject({
      url: validEnv.SUPABASE_URL,
      key: validEnv.SUPABASE_PUBLISHABLE_KEY,
      authorization: "Bearer valid-token",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
    expect(JSON.stringify(clientCalls)).not.toContain("attacker-token");
    expect(JSON.stringify(clientCalls)).not.toContain("service_role");
    expect(signOuts).toEqual([]);
    await app.close();
  });
});

describe("account export", () => {
  it("rejects a caller-supplied owner and does not read", async () => {
    seed("valid-token", { conversations: [conversation()], messages: [message()] });
    const app = await buildAccountApp();
    for (const url of [
      "/v1/account/export?user_id=attacker-id",
      "/v1/account/export?userId=attacker-id",
      "/v1/account/export?user=attacker-id",
    ]) {
      const response = await app.inject({ method: "GET", url, headers: bearer() });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("validation_error");
      expect(response.json().error.message).toBe("Export is limited to your account.");
      expect(JSON.stringify(response.json())).not.toContain("attacker-id");
    }
    expect(operations).toEqual([]);
    await app.close();
  });

  it("exports only the verified owner's rows as version 1", async () => {
    seed("valid-token", {
      conversations: [
        conversation({ api_key: "sk-live", email: "owner@example.com" }),
        conversation({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Not mine",
          user_id: "user-b",
          created_at: "2026-04-01T00:00:00.000Z",
        }),
      ],
      messages: [
        message(),
        message({
          id: "44444444-4444-4444-8444-444444444444",
          conversation_id: "33333333-3333-4333-8333-333333333333",
          content: "other private note",
          user_id: "user-b",
        }),
      ],
      user_preferences: [conversation({ id: "pref", title: "AboutYouDoNotExport" })],
    });
    sessions.set("token-b", "user-b");
    seed("token-b", {
      conversations: [conversation({ id: "33333333-3333-4333-8333-333333333333", title: "Other account", user_id: "user-b", selected_model: "Reasoning" })],
      messages: [],
    });
    const app = await buildAccountApp();
    const requestId = "6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20";
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/export?exportedAt=1999-01-01T00:00:00.000Z",
      headers: bearer("valid-token", { "x-user-id": "user-b", "x-request-id": requestId }),
    });
    const other = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: bearer("token-b"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="nibie-export-v1.json"');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    const body = response.json();
    expect(body).toMatchObject({
      product: "Nibie",
      exportVersion: 1,
      conversations: [{
        id: conversationId,
        title: "Mine",
        selectedModel: "Fast",
        messages: [{ id: messageId, content: "only mine", role: "user", status: "complete" }],
      }],
    });
    expect(body.exportedAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(body.conversations).toHaveLength(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Not mine");
    expect(serialized).not.toContain("other private note");
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("user-123");
    expect(serialized).not.toContain("AboutYouDoNotExport");
    expect(other.json().conversations).toEqual([
      expect.objectContaining({ id: "33333333-3333-4333-8333-333333333333", title: "Other account", selectedModel: "Reasoning" }),
    ]);
    const ranges = operations.filter((operation) => operation.op === "range");
    expect(ranges.map((operation) => operation.table)).toEqual(["conversations", "messages", "conversations", "messages"]);
    expect(ranges[0]).toMatchObject({
      token: "valid-token",
      columns: "id,title,selected_model,chat_role,custom_instructions,created_at,updated_at",
      filters: [["user_id", "user-123"]],
      orders: ["created_at", "id"],
      from: 0,
      to: 999,
    });
    expect(ranges[1]).toMatchObject({
      token: "valid-token",
      columns: "id,conversation_id,role,content,status,position,created_at,reply_to_message_id",
      filters: [["user_id", "user-123"]],
      orders: ["conversation_id", "position", "id"],
    });
    expect(ranges[2]?.filters).toEqual([["user_id", "user-b"]]);
    expect(operations.some((operation) => operation.table === "user_preferences" || operation.table === "users")).toBe(false);
    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(clientCalls[1]?.authorization).toBe("Bearer token-b");
    await app.close();
  });

  it("exports an empty account as version 1", async () => {
    seed("valid-token", {});
    const app = await buildAccountApp();
    const response = await app.inject({ method: "GET", url: "/v1/account/export", headers: bearer() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ product: "Nibie", exportVersion: 1, conversations: [] });
    await app.close();
  });

  it("fails closed on a read error, an orphan message, or a stuck page", async () => {
    seed("valid-token", { conversations: [conversation({ title: "MineDoNotLeak" })], messages: [message({ content: "MessageDoNotLeak" })] });
    forcedError = { code: "XX000", message: "relation conversations leaked" };
    const app = await buildAccountApp();
    const failed = await app.inject({ method: "GET", url: "/v1/account/export", headers: bearer() });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("service_unavailable");
    expect(failed.json().error.message).toBe("Your conversations couldn't be exported. Please try again.");
    expect(JSON.stringify(failed.json())).not.toContain("MineDoNotLeak");
    expect(JSON.stringify(failed.json())).not.toContain("relation");
    expect(JSON.stringify(failed.json())).not.toContain("MessageDoNotLeak");
    expect(operations.some((operation) => operation.table === "messages")).toBe(false);

    forcedError = null;
    seed("valid-token", {
      conversations: [],
      messages: [message({ content: "orphaned private note" })],
    });
    const orphan = await app.inject({ method: "GET", url: "/v1/account/export", headers: bearer() });
    expect(orphan.statusCode).toBe(503);
    expect(JSON.stringify(orphan.json())).not.toContain("orphaned private note");
    expect(orphan.json().conversations).toBeUndefined();

    const stuckRows = Array.from({ length: 1000 }, () => conversation({ id: "same-id", title: "StuckTitleDoNotExport" }));
    seed("valid-token", { conversations: stuckRows, messages: [] });
    repeatFullPage = true;
    const stuck = await app.inject({ method: "GET", url: "/v1/account/export", headers: bearer() });
    expect(stuck.statusCode).toBe(503);
    expect(JSON.stringify(stuck.json())).not.toContain("StuckTitleDoNotExport");
    await app.close();
  });

  it("reads the next page and does not return a partial snapshot", async () => {
    const conversations = Array.from({ length: 1001 }, (_, index) => conversation({
      id: `c${String(index).padStart(4, "0")}`,
      title: index === 1000 ? "Last page" : "Chat",
      user_id: "user-123",
    }));
    seed("valid-token", { conversations, messages: [] });
    const app = await buildAccountApp();
    const response = await app.inject({ method: "GET", url: "/v1/account/export", headers: bearer() });
    expect(response.statusCode).toBe(200);
    expect(response.json().conversations).toHaveLength(1001);
    expect(response.json().conversations[1000].title).toBe("Last page");
    const ranges = operations.filter((operation) => operation.op === "range" && operation.table === "conversations");
    expect(ranges.map((operation) => [operation.from, operation.to])).toEqual([[0, 999], [1000, 1999]]);
    await app.close();
  });

  it("maps a forbidden read without policy text", async () => {
    seed("valid-token", { conversations: [conversation()], messages: [] });
    forcedError = { code: "42501", message: "new row violates row-level security policy for conversations" };
    const app = await buildAccountApp();
    const response = await app.inject({ method: "GET", url: "/v1/account/export", headers: bearer() });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({ code: "forbidden", message: "Forbidden." });
    expect(JSON.stringify(response.json())).not.toMatch(/policy|row-level|Mine/i);
    await app.close();
  });
});

describe("delete all conversations", () => {
  it("deletes only the verified owner's conversations", async () => {
    const owned = conversation({ id: "owned-chat" });
    const other = conversation({ id: "other-chat", user_id: "user-b", title: "Keep" });
    seed("valid-token", {
      conversations: [owned, other],
      messages: [message()],
      user_preferences: [{ id: "pref", preferred_name: "Habib" }],
      users: [{ id: "user-123" }],
    });
    const app = await buildAccountApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer("valid-token", { "x-user-id": "user-b" }),
      payload: { confirmation: " DELETE " },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ deletedCount: 1 });
    expect(rows.get("valid-token")?.conversations.map((row) => row.id)).toEqual(["other-chat"]);
    expect(rows.get("valid-token")?.user_preferences).toHaveLength(1);
    expect(rows.get("valid-token")?.users).toHaveLength(1);
    expect(rows.get("valid-token")?.messages).toHaveLength(1);
    const deletes = operations.filter((operation) => operation.op === "delete");
    expect(deletes).toEqual([expect.objectContaining({ token: "valid-token", table: "conversations" })]);
    expect(operations.some((operation) => operation.op === "eq" && operation.value === "user-123")).toBe(true);
    expect(operations.some((operation) => operation.value === "user-b")).toBe(false);
    expect(operations.some((operation) => ["messages", "users", "user_preferences"].includes(operation.table))).toBe(false);
    expect(signOuts).toEqual([]);
    await app.close();
  });

  it("rejects any confirmation other than DELETE and any owner selector", async () => {
    seed("valid-token", { conversations: [conversation()] });
    const app = await buildAccountApp();
    const cases = [
      [{ confirmation: "delete" }, "Type DELETE to confirm."],
      [{ confirmation: "Delete" }, "Type DELETE to confirm."],
      [{ confirmation: "DELETED" }, "Type DELETE to confirm."],
      [{ confirmation: "" }, "Type DELETE to confirm."],
      [{ confirmation: "DELETE ACCOUNT" }, "Type DELETE to confirm."],
      [{ confirmation: " DELETE\nnow" }, "Type DELETE to confirm."],
      [{}, "Type DELETE to confirm."],
      [{ confirmation: "DELETE", user_id: "attacker-id" }, "Type DELETE to confirm."],
      [{ confirmation: "DELETE", userId: "attacker-id" }, "Type DELETE to confirm."],
      [{ confirmation: "DELETE", user: "attacker-id" }, "Type DELETE to confirm."],
    ] as const;

    for (const [payload, message] of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/account/conversations/delete-all",
        headers: bearer("valid-token", { "x-request-id": "6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20" }),
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("validation_error");
      expect(response.json().error.message).toBe(message);
      expect(response.json().error.requestId).toBe("6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20");
      expect(JSON.stringify(response.json())).not.toContain("attacker-id");
    }

    const rawString = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer("valid-token", { "content-type": "application/json" }),
      payload: "\"DELETE\"",
    });
    expect(rawString.statusCode).toBe(400);
    expect(rawString.json().error.message).toBe("Type DELETE to confirm.");

    const queried = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all?user_id=attacker-id",
      headers: bearer(),
      payload: { confirmation: "DELETE" },
    });
    expect(queried.statusCode).toBe(400);
    expect(queried.json().error.message).toBe("Invalid request.");
    expect(operations.some((operation) => operation.op === "delete")).toBe(false);
    expect(rows.get("valid-token")?.conversations).toHaveLength(1);
    await app.close();
  });

  it("does not report success when the delete fails", async () => {
    seed("valid-token", { conversations: [conversation({ title: "Still here" })] });
    forcedError = { code: "XX000", message: "delete failed internally" };
    const app = await buildAccountApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer(),
      payload: { confirmation: "DELETE" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toBe("Conversations couldn't be deleted. Please try again.");
    expect(response.json().deletedCount).toBeUndefined();
    expect(JSON.stringify(response.json())).not.toContain("delete failed");
    expect(JSON.stringify(response.json())).not.toContain("Still here");
    expect(rows.get("valid-token")?.conversations).toHaveLength(1);

    forcedError = { code: "42501", message: "row-level security policy on conversations" };
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer(),
      payload: { confirmation: "DELETE" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.message).toBe("Forbidden.");
    expect(JSON.stringify(forbidden.json())).not.toMatch(/policy|row-level/i);
    await app.close();
  });

  it("returns zero when the owner has no conversations", async () => {
    seed("valid-token", { user_preferences: [{ id: "pref" }] });
    const app = await buildAccountApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer(),
      payload: { confirmation: "DELETE" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deletedCount: 0 });
    expect(rows.get("valid-token")?.user_preferences).toHaveLength(1);
    await app.close();
  });
});

describe("global sign-out", () => {
  it("revokes every session with the verified bearer and the global scope", async () => {
    sessions.set("token-b", "user-b");
    seed("valid-token", { conversations: [conversation()] });
    const app = await buildAccountApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: bearer("valid-token", { "x-access-token": "attacker-token", "x-request-id": "6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20" }),
      payload: {},
    });
    const other = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: bearer("token-b"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20");
    expect(response.json()).toEqual({ scope: "global" });
    expect(other.json()).toEqual({ scope: "global" });
    expect(signOuts).toEqual([
      { token: "valid-token", jwt: "valid-token", scope: "global" },
      { token: "token-b", jwt: "token-b", scope: "global" },
    ]);
    expect(operations).toEqual([]);
    expect(rows.get("valid-token")?.conversations).toHaveLength(1);
    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(clientCalls[0]?.authorization).toBe("Bearer valid-token");
    expect(clientCalls[1]?.authorization).toBe("Bearer token-b");
    await app.close();
  });

  it("rejects a client scope or owner and does not sign out", async () => {
    const app = await buildAccountApp();
    const cases = [
      { scope: "local" },
      { scope: "others" },
      { scope: "global" },
      { user_id: "attacker-id" },
      { userId: "attacker-id" },
      { user: "attacker-id", scope: "global" },
      { jwt: "attacker-token" },
      { accessToken: "attacker-token" },
    ];
    for (const payload of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/sign-out",
        headers: bearer(),
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("validation_error");
      expect(response.json().error.message).toBe("Invalid request.");
      expect(JSON.stringify(response.json())).not.toContain("attacker");
    }
    const queried = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out?user_id=attacker-id",
      headers: bearer(),
      payload: {},
    });
    expect(queried.statusCode).toBe(400);
    expect(signOuts).toEqual([]);
    await app.close();
  });

  it("accepts an empty body and does not report success when logout fails", async () => {
    const app = await buildAccountApp();
    const empty = await app.inject({ method: "POST", url: "/v1/auth/sign-out", headers: bearer() });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ scope: "global" });

    signOutError = { status: 401, message: "logout token do not echo" };
    const unauthorized = await app.inject({ method: "POST", url: "/v1/auth/sign-out", headers: bearer(), payload: {} });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.message).toBe("Authentication required.");
    expect(JSON.stringify(unauthorized.json())).not.toContain("do not echo");

    signOutError = { status: 500, message: "gotrue internal do not echo" };
    const unavailable = await app.inject({ method: "POST", url: "/v1/auth/sign-out", headers: bearer(), payload: {} });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.message).toBe("Sign-out is temporarily unavailable. Please try again.");
    expect(JSON.stringify(unavailable.json())).not.toContain("gotrue");

    signOutError = null;
    signOutThrown = new Error("network logout do not echo");
    const thrown = await app.inject({ method: "POST", url: "/v1/auth/sign-out", headers: bearer(), payload: {} });
    expect(thrown.statusCode).toBe(503);
    expect(JSON.stringify(thrown.json())).not.toContain("network logout");
    await app.close();
  });
});

describe("account boundaries", () => {
  it("does not implement account deletion", async () => {
    seed("valid-token", { conversations: [conversation()], users: [{ id: "user-123" }] });
    const app = await buildAccountApp();
    const paths = ["/v1/account", "/v1/account/delete", "/v1/auth/users", "/v1/account/conversations/delete-all"];
    for (const url of paths) {
      const response = await app.inject({
        method: "DELETE",
        url,
        headers: bearer(),
        payload: { confirmation: "DELETE ACCOUNT" },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("not_found");
    }
    const posted = await app.inject({
      method: "POST",
      url: "/v1/account/delete",
      headers: bearer(),
      payload: { confirmation: "DELETE ACCOUNT" },
    });
    expect(posted.statusCode).toBe(404);
    expect(operations.some((operation) => operation.op === "delete")).toBe(false);
    expect(signOuts).toEqual([]);
    expect(rows.get("valid-token")?.users).toHaveLength(1);
    await app.close();
  });

  it("rejects a foreign origin before reading or revoking", async () => {
    seed("valid-token", { conversations: [conversation()] });
    const app = await buildAccountApp();
    const exported = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: bearer("valid-token", { origin: "https://evil.example" }),
    });
    const deleted = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer("valid-token", { origin: "https://evil.example" }),
      payload: { confirmation: "DELETE" },
    });
    const signedOut = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: bearer("valid-token", { origin: "https://evil.example" }),
      payload: {},
    });

    expect(exported.statusCode).toBe(403);
    expect(deleted.statusCode).toBe(403);
    expect(signedOut.statusCode).toBe(403);
    expect(exported.json().error.code).toBe("origin_rejected");
    expect(exported.headers["access-control-allow-origin"]).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(operations).toEqual([]);
    expect(signOuts).toEqual([]);
    await app.close();
  });

  it("rejects an oversized or non-JSON mutation without echoing it", async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const app = await buildAccountApp({ ...validEnv, LOG_LEVEL: "info" }, logStream);
    const oversized = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer(),
      payload: { confirmation: `SecretDoNotLog${"x".repeat(5_000)}` },
    });
    const text = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-out",
      headers: bearer("valid-token", { "content-type": "text/plain" }),
      payload: "scope=local",
    });
    const broken = await app.inject({
      method: "POST",
      url: "/v1/account/conversations/delete-all",
      headers: bearer("valid-token", { "content-type": "application/json" }),
      payload: "{\"confirmation\": \"SecretDoNotLog\"",
    });

    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().error.code).toBe("validation_error");
    expect(text.statusCode).toBe(415);
    expect(text.json().error.code).toBe("unsupported_media_type");
    expect(broken.statusCode).toBe(400);
    const packed = `${JSON.stringify(oversized.json())}\n${JSON.stringify(broken.json())}\n${lines.join("\n")}`;
    expect(packed).not.toContain("SecretDoNotLog");
    expect(operations.some((operation) => operation.op === "delete")).toBe(false);
    expect(signOuts).toEqual([]);
    await app.close();
  });

  it("does not log export contents, tokens, or cookies", async () => {
    sessions.set("export-token-do-not-log", "user-123");
    seed("export-token-do-not-log", {
      conversations: [conversation({ title: "TitleDoNotLog" })],
      messages: [message({ content: "MessageContentDoNotLog" })],
    });
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const app = await buildAccountApp({ ...validEnv, LOG_LEVEL: "info" }, logStream);
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/export?note=NoteDoNotLog",
      headers: bearer("export-token-do-not-log", {
        cookie: "sb-access-token=cookie-do-not-log",
        "x-request-id": "6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20",
      }),
    });
    const logs = lines.join("\n");
    expect(response.statusCode).toBe(200);
    expect(logs).toContain("\"requestId\":\"6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20\"");
    expect(logs).toContain("\"method\":\"GET\"");
    expect(logs).toContain("\"path\":\"/v1/account/export\"");
    expect(logs).toContain("\"status\":200");
    expect(logs).not.toContain("export-token-do-not-log");
    expect(logs).not.toContain("cookie-do-not-log");
    expect(logs).not.toContain("TitleDoNotLog");
    expect(logs).not.toContain("MessageContentDoNotLog");
    expect(logs).not.toContain("NoteDoNotLog");
    expect(logs).not.toContain("only mine");
    await app.close();
  });

  it("leaves health probes public", async () => {
    const app = await buildAccountApp();
    const health = await app.inject({ method: "GET", url: "/health" });
    const versioned = await app.inject({ method: "GET", url: "/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(versioned.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
    expectUuid(health.headers["x-request-id"]);
    expect(verifyToken).not.toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("account security boundary", () => {
  it("keeps privileged database access and caller JWT injection out of the route", () => {
    const route = source("../src/routes/v1/account.ts");
    const repository = source("../src/account/repository.ts");
    const supabase = source("../src/plugins/supabase.ts");
    const parser = source("../../../packages/contracts/src/account.ts");
    const product = `${route}\n${repository}`;

    expect(product).not.toMatch(/service_role|DATABASE_URL|AI_API_KEY|sb_secret_|createClient|deleteUser|drizzle|postgres|auth\.admin/);
    expect(route).not.toMatch(/readVerifiedAccessToken|Authorization|accessToken/);
    expect(supabase).toContain("client.auth.admin.signOut(accessToken, SIGN_OUT_SCOPE)");
    expect(supabase).not.toMatch(/deleteUser|service_role|DATABASE_URL|scope:\s*["']local["']|scope:\s*["']others["']/);
    expect(supabase).not.toMatch(/export function createUserSupabaseClient/);
    expect(parser).toContain("return { scope: SIGN_OUT_SCOPE }");
    expect(parser).not.toMatch(/input\.scope|body\.scope|parsed\.data\.scope/);
  });
});
