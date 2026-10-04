import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));

import { createPinAction, deletePinAction, updatePinAction } from "../../app/actions/pins";

const roomA = "11111111-1111-4111-8111-111111111111";
const roomB = "22222222-2222-4222-8222-222222222222";
const pinB = "33333333-3333-4333-8333-333333333333";

type PinRecord = {
  id: string;
  user_id: string;
  room_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function memoryClient(actor = "user-a") {
  const rooms = new Map<string, string>([[roomA, "user-a"], [roomB, "user-b"]]);
  const pins = new Map<string, PinRecord>([[pinB, {
    id: pinB,
    user_id: "user-b",
    room_id: roomB,
    title: "Private",
    content: "Do not read this.",
    created_at: "2026-10-02T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
  }]]);
  const writes: PinRecord[] = [];
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: actor } }, error: null }) },
    from: (table: string) => {
      if (table === "rooms") {
        return {
          select: () => ({
            eq: (_column: string, id: string) => ({
              maybeSingle: async () => {
                const owner = rooms.get(id);
                if (owner !== actor) return { data: null, error: null };
                return { data: { id }, error: null };
              },
            }),
          }),
        };
      }
      return {
        insert: (row: Omit<PinRecord, "id" | "created_at" | "updated_at">) => ({
          select: () => ({
            single: async () => {
              if (row.user_id !== actor || rooms.get(row.room_id) !== actor) return { data: null, error: { code: "23503" } };
              const saved: PinRecord = { ...row, id: "44444444-4444-4444-8444-444444444444", created_at: "2026-10-03T00:00:00.000Z", updated_at: "2026-10-03T00:00:00.000Z" };
              pins.set(saved.id, saved);
              writes.push(saved);
              return { data: saved, error: null };
            },
          }),
        }),
        update: (patch: { title: string; content: string }) => ({
          eq: (_column: string, id: string) => ({
            select: () => ({
              maybeSingle: async () => {
                const current = pins.get(id);
                if (!current || current.user_id !== actor) return { data: null, error: null };
                const saved = { ...current, ...patch, updated_at: "2026-10-03T00:00:01.000Z" };
                pins.set(id, saved);
                writes.push(saved);
                return { data: saved, error: null };
              },
            }),
          }),
        }),
        delete: () => ({
          eq: (_column: string, id: string) => ({
            select: () => ({
              maybeSingle: async () => {
                const current = pins.get(id);
                if (!current || current.user_id !== actor) return { data: null, error: null };
                pins.delete(id);
                return { data: { id }, error: null };
              },
            }),
          }),
        }),
      };
    },
  };
  return { client, pins, writes };
}

describe("pin create, update, and delete", () => {
  beforeEach(() => createClient.mockReset());

  it("creates a pin for the signed-in owner on a room they own", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    const result = await createPinAction(roomA, { title: " Deployment rule ", content: " Production stays in Seoul. " });
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ room_id: roomA, title: "Deployment rule", content: "Production stays in Seoul." });
    expect(memory.writes[0]?.user_id).toBe("user-a");
    expect(memory.pins.get(result.data!.id)?.content).toBe("Production stays in Seoul.");
  });

  it("refuses to attach a pin to another user's room", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    await expect(createPinAction(roomB, { title: "Rule", content: "Not yours." })).resolves.toEqual({ error: "That room is no longer available." });
    expect(memory.writes).toHaveLength(0);
    expect(memory.pins.has(pinB)).toBe(true);
  });

  it("rejects a client-supplied owner before opening a client", async () => {
    await expect(createPinAction(roomA, { title: "Rule", content: "Kept.", user_id: "user-b" })).resolves.toEqual({ error: "Choose a valid pin." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("updates and deletes only the caller's pin", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    const created = await createPinAction(roomA, { title: "Rule", content: "First draft." });
    const updated = await updatePinAction(created.data!.id, { title: "Rule", content: "Revised draft." });
    expect(updated.data?.content).toBe("Revised draft.");
    await expect(updatePinAction(pinB, { title: "Hijack", content: "Stolen." })).resolves.toEqual({ error: "That pin is no longer available." });
    await expect(deletePinAction(pinB)).resolves.toEqual({ error: "That pin is no longer available." });
    expect(memory.pins.get(pinB)?.content).toBe("Do not read this.");
    await expect(deletePinAction(created.data!.id)).resolves.toEqual({});
    expect(memory.pins.has(created.data!.id)).toBe(false);
  });
});
