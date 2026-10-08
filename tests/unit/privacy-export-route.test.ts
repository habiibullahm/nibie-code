import { describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));

import { GET } from "../../app/api/account/export/route";

const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Mine",
  selected_model: "Fast",
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-02T00:00:00.000Z",
};
const message = {
  id: "22222222-2222-4222-8222-222222222222",
  conversation_id: conversation.id,
  role: "user",
  content: "only mine",
  status: "complete",
  position: 1,
  created_at: "2026-03-01T00:00:01.000Z",
  reply_to_message_id: null,
};
const attachment = {
  id: "66666666-6666-4666-8666-666666666666",
  message_id: message.id,
  original_name: "notes.txt",
  extracted_text: "attachment body",
};

function signedIn(userId: string | null, rows: Record<string, unknown[]>) {
  const filters: Array<[string, string]> = [];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const api = {
      select: () => api,
      eq: (column: string, value: string) => { filters.push([column, value]); return api; },
      order: () => api,
      range: async () => ({ data: rows[table] ?? [], error: null }),
    };
    return api;
  });
  createClient.mockResolvedValue({
    auth: { getClaims: async () => (userId ? { data: { claims: { sub: userId } }, error: null } : { data: null, error: new Error("no session") }) },
    from,
  });
  return { from, filters, tables };
}

function request(path = "/api/account/export") {
  return new Request(`http://localhost${path}`);
}

describe("GET /api/account/export", () => {
  it("requires authentication before reading any account data", async () => {
    const { from } = signedIn(null, {});
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied user id and does not query", async () => {
    const { from } = signedIn("owner-a", {
      conversations: [conversation],
      messages: [message],
      message_attachments: [attachment],
    });
    const response = await GET(request("/api/account/export?user_id=owner-b"));
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Export is limited to your account." });
  });

  it("exports only the verified owner's rows including attachment names and text", async () => {
    const { filters, tables } = signedIn("owner-a", {
      conversations: [conversation],
      messages: [message],
      message_attachments: [attachment],
    });
    const response = await GET(request("/api/account/export?userId=owner-b"));
    expect(response.status).toBe(400);
    expect(tables).toEqual([]);

    const ok = await GET(request());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toContain("nibie-export-v2.json");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await ok.json();
    expect(body).toMatchObject({
      product: "Nibie",
      exportVersion: 2,
      conversations: [{
        id: conversation.id,
        selectedModel: "Fast",
        messages: [{
          content: "only mine",
          attachments: [{ originalName: "notes.txt", extractedText: "attachment body" }],
        }],
      }],
    });
    expect(JSON.stringify(body)).not.toContain("owner-b");
    expect(filters).toEqual([
      ["user_id", "owner-a"],
      ["user_id", "owner-a"],
      ["user_id", "owner-a"],
    ]);
    expect(tables).toEqual(["conversations", "messages", "message_attachments"]);
  });

  it("exports an empty account as version 2 with no conversations", async () => {
    signedIn("owner-a", { conversations: [], messages: [], message_attachments: [] });
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ product: "Nibie", exportVersion: 2, conversations: [] });
  });

  it("fails closed when a read errors and does not return a partial file", async () => {
    const from = vi.fn((table: string) => {
      const api = {
        select: () => api,
        eq: () => api,
        order: () => api,
        range: async () => table === "messages"
          ? { data: null, error: { message: "relation leaked" } }
          : { data: [conversation], error: null },
      };
      return api;
    });
    createClient.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: "owner-a" } }, error: null }) },
      from,
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("Mine");
    expect(JSON.stringify(body)).not.toContain("relation leaked");
  });
});
