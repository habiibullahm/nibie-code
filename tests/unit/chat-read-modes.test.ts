import { describe, expect, it, vi } from "vitest";
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
import { getChatWorkspaceData } from "../../lib/chat/read";

// Every query resolves to the same fixed rows, whatever filters or ordering are chained on it.
function rows(data: unknown) {
  const builder: unknown = new Proxy({}, { get: (_target, property) => property === "then" ? (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) : () => builder });
  return builder;
}
const stamp = "2026-10-04T00:00:00.000Z";
const conversation = (id: string, selected_model: string) => ({ id, title: id, selected_model, room_id: null, archived_at: null, created_at: stamp, updated_at: stamp });

describe("saved conversation modes reach the client already normalized", () => {
  it("turns a legacy Reasoning row into High and leaves canonical and unknown values alone", async () => {
    createClient.mockResolvedValue({ from: (table: string) => rows(table === "conversations"
      ? [conversation("old", "Reasoning"), conversation("new", "High"), conversation("fast", "Fast"), conversation("odd", "default")]
      : []) });
    const data = await getChatWorkspaceData(undefined);
    expect(Object.fromEntries(data.conversations.map((item) => [item.id, item.selected_model]))).toEqual({ old: "High", new: "High", fast: "Fast", odd: "default" });
    expect(JSON.stringify(data)).not.toContain("Reasoning");
  });
});
