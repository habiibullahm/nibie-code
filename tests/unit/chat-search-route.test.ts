import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
const getUser = vi.fn();
const searchOwned = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/auth/get-user", () => ({ getAuthenticatedUser: getUser }));
vi.mock("@/lib/chat/search-owned", () => ({ searchOwnedChats: searchOwned }));

import { GET } from "../../app/api/chat/search/route";

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers: { origin: "http://localhost", ...headers } });
}

describe("GET /api/chat/search", () => {
  beforeEach(() => {
    createClient.mockReset();
    getUser.mockReset();
    searchOwned.mockReset();
    createClient.mockResolvedValue({ from: vi.fn() });
    getUser.mockResolvedValue({ id: "user-1" });
    searchOwned.mockResolvedValue({
      ok: true,
      data: { query: "auth", conversations: [], messages: [], archived: [] },
    });
  });

  it("requires authentication", async () => {
    getUser.mockResolvedValue(null);
    expect((await GET(request("http://localhost/api/chat/search?q=ab"))).status).toBe(401);
  });

  it("rejects cross-origin requests and client user ids", async () => {
    expect((await GET(request("http://localhost/api/chat/search?q=ab", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await GET(request("http://localhost/api/chat/search?q=ab&user_id=other"))).status).toBe(400);
  });

  it("returns owned search results", async () => {
    const response = await GET(request("http://localhost/api/chat/search?q=auth"));
    expect(response.status).toBe(200);
    expect(searchOwned).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ query: "auth", conversations: [], messages: [], archived: [] });
  });

  it("maps service failures to 503", async () => {
    searchOwned.mockResolvedValue({ ok: false, error: "Search is temporarily unavailable.", status: 503 });
    expect((await GET(request("http://localhost/api/chat/search?q=auth"))).status).toBe(503);
  });
});
