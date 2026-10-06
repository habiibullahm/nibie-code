import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, backfill } = vi.hoisted(() => ({ createClient: vi.fn(), backfill: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/files/search", () => ({ backfillRoomFileEmbeddings: backfill }));

import { POST } from "../../app/api/rooms/[roomId]/files/backfill-embeddings/route";
import { resetBackfillGuardForTests } from "../../lib/files/backfill-guard";

const owner = "7c1f8a52-4f61-4d7e-9a3e-1b2c3d4e5f60";
const room = "5e9bdcca-9205-4fea-a773-13952bb78c44";
function request(origin = "http://localhost") {
  return new Request(`http://localhost/api/rooms/${room}/files/backfill-embeddings`, { method: "POST", headers: { origin } });
}
function setup({ authenticated = true, roomExists = true } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: roomExists ? { id: room } : null, error: null });
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle };
  const from = vi.fn(() => query);
  createClient.mockResolvedValue({ auth: { getClaims: vi.fn().mockResolvedValue(authenticated ? { data: { claims: { sub: owner } }, error: null } : { data: null, error: new Error("anonymous") }) }, from });
  return { from, maybeSingle };
}

describe("POST /api/rooms/[roomId]/files/backfill-embeddings", () => {
  beforeEach(() => {
    createClient.mockReset();
    backfill.mockReset();
    resetBackfillGuardForTests();
  });

  it("requires a signed-in owner and rejects cross-origin requests", async () => {
    const { from } = setup({ authenticated: false });
    expect((await POST(request(), { params: Promise.resolve({ roomId: room }) })).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    setup();
    expect((await POST(request("https://attacker.example"), { params: Promise.resolve({ roomId: room }) })).status).toBe(403);
    expect(backfill).not.toHaveBeenCalled();
  });

  it("runs at most one missing-only batch against the authenticated owner's Room", async () => {
    const { from } = setup();
    backfill.mockResolvedValue(7);
    const response = await POST(request(), { params: Promise.resolve({ roomId: room }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ processed: 7, limit: 20 });
    expect(from).toHaveBeenCalledWith("rooms");
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledWith(expect.anything(), room, 20);
  });

  it("fails closed for invalid or unavailable Rooms and hides provider errors", async () => {
    const { from } = setup();
    expect((await POST(request(), { params: Promise.resolve({ roomId: "../other" }) })).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    setup({ roomExists: false });
    expect((await POST(request(), { params: Promise.resolve({ roomId: room }) })).status).toBe(404);
    setup();
    backfill.mockRejectedValue(new Error("provider detail must not leak"));
    const response = await POST(request(), { params: Promise.resolve({ roomId: room }) });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Embeddings are unavailable. Please try again." });
  });

  it("rejects a second concurrent backfill for the same user", async () => {
    setup();
    let release!: () => void;
    backfill.mockImplementation(() => new Promise<number>((resolve) => { release = () => resolve(1); }));
    const first = POST(request(), { params: Promise.resolve({ roomId: room }) });
    await vi.waitFor(() => expect(backfill).toHaveBeenCalledTimes(1));
    setup();
    const second = await POST(request(), { params: Promise.resolve({ roomId: room }) });
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });

  it("rate-limits more than six started batches per minute per user", async () => {
    backfill.mockResolvedValue(1);
    for (let i = 0; i < 6; i++) {
      setup();
      expect((await POST(request(), { params: Promise.resolve({ roomId: room }) })).status).toBe(200);
    }
    setup();
    const limited = await POST(request(), { params: Promise.resolve({ roomId: room }) });
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: expect.stringMatching(/rate limited/i) });
  });
});
