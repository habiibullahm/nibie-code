import { describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));

import { GET } from "../../app/api/conversations/[id]/transcript/route";

const conversationId = "11111111-1111-4111-8111-111111111111";
const otherId = "33333333-3333-4333-8333-333333333333";

const conversation = {
  id: conversationId,
  title: "Mine",
  archived_at: null,
};

const messages = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    content: "only mine",
    status: "complete",
    position: 1,
    created_at: "2026-03-01T00:00:01.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    role: "assistant",
    content: "<think>hide</think>Hello **world**",
    status: "complete",
    position: 2,
    created_at: "2026-03-01T00:00:02.000Z",
  },
];

function signedIn(userId: string | null, options?: {
  conversation?: typeof conversation | null;
  messages?: typeof messages;
  conversationError?: unknown;
}) {
  const filters: Array<[string, string]> = [];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    if (table === "conversations") {
      const api = {
        select: () => api,
        eq: (column: string, value: string) => { filters.push([column, value]); return api; },
        maybeSingle: async () => ({
          data: options?.conversation === undefined ? conversation : options.conversation,
          error: options?.conversationError ?? null,
        }),
      };
      return api;
    }
    const api = {
      select: () => api,
      eq: (column: string, value: string) => { filters.push([column, value]); return api; },
      order: () => api,
      range: async () => ({ data: options?.messages ?? messages, error: null }),
    };
    return api;
  });
  createClient.mockResolvedValue({
    auth: {
      getClaims: async () => (userId
        ? { data: { claims: { sub: userId } }, error: null }
        : { data: null, error: new Error("no session") }),
    },
    from,
  });
  return { from, filters, tables };
}

function request(path: string, headers?: HeadersInit) {
  return new Request(`http://localhost${path}`, { headers });
}

describe("GET /api/conversations/[id]/transcript", () => {
  it("requires authentication before reading", async () => {
    const { from } = signedIn(null);
    const response = await GET(request(`/api/conversations/${conversationId}/transcript`), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied user ids", async () => {
    const { from } = signedIn("owner-a");
    const response = await GET(request(`/api/conversations/${conversationId}/transcript?user_id=owner-b`), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Transcript is limited to your account." });
  });

  it("rejects cross-origin requests", async () => {
    signedIn("owner-a");
    const response = await GET(
      request(`/api/conversations/${conversationId}/transcript`, { origin: "https://evil.example" }),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(response.status).toBe(403);
  });

  it("returns 404 for another owner's conversation without leaking existence", async () => {
    const { filters } = signedIn("owner-a", { conversation: null });
    const response = await GET(request(`/api/conversations/${otherId}/transcript`), {
      params: Promise.resolve({ id: otherId }),
    });
    expect(response.status).toBe(404);
    expect(filters).toEqual([
      ["id", otherId],
      ["user_id", "owner-a"],
    ]);
    await expect(response.json()).resolves.toEqual({ error: "Conversation not found." });
  });

  it("returns plain text without Markdown markers and filters to the owner", async () => {
    const { filters, tables } = signedIn("owner-a");
    const response = await GET(request(`/api/conversations/${conversationId}/transcript?format=plain`), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBeNull();
    const body = await response.text();
    expect(body).toContain("Mine");
    expect(body).toContain("only mine");
    expect(body).toContain("Hello world");
    expect(body).not.toContain("hide");
    expect(body).not.toContain("**");
    expect(tables).toEqual(["conversations", "messages"]);
    expect(filters).toEqual([
      ["id", conversationId],
      ["user_id", "owner-a"],
      ["conversation_id", conversationId],
      ["user_id", "owner-a"],
    ]);
  });

  it("returns plain text for archived owner threads and rejects markdown format", async () => {
    signedIn("owner-a", {
      conversation: { ...conversation, title: "Archived/Notes", archived_at: "2026-03-02T00:00:00.000Z" as unknown as null },
    });
    const archived = await GET(request(`/api/conversations/${conversationId}/transcript`), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(archived.status).toBe(200);
    expect(archived.headers.get("content-type")).toContain("text/plain");
    expect(archived.headers.get("content-disposition")).toBeNull();
    const body = await archived.text();
    expect(body).toContain("Archived/Notes");
    expect(body).toContain("Hello world");
    expect(body).not.toContain("<think>");

    const markdown = await GET(
      request(`/api/conversations/${conversationId}/transcript?format=markdown`),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(markdown.status).toBe(400);
  });

  it("rejects invalid conversation ids", async () => {
    signedIn("owner-a");
    const response = await GET(request("/api/conversations/not-a-uuid/transcript"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });
});
