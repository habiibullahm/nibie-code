import { describe, expect, it } from "vitest";
import { groupThreads } from "../../lib/chat/groups";

describe("sidebar Room and General grouping", () => {
  it("groups each thread once under its persisted context, keeping separate histories", () => {
    const threads = [
      { id: "general", room_id: null }, { id: "a1", room_id: "a" },
      { id: "a2", room_id: "a" }, { id: "b", room_id: "b" },
      { id: "archived-general", room_id: null, archived_at: "2026-10-03" },
      { id: "archived-room", room_id: "a", archived_at: "2026-10-03" },
    ];
    const grouped = groupThreads(threads);
    expect(grouped.general.map((item) => item.id)).toEqual(["general"]);
    expect(grouped.byRoom.get("a")?.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(grouped.byRoom.get("b")?.map((item) => item.id)).toEqual(["b"]);
    const visible = [...grouped.general, ...Array.from(grouped.byRoom.values()).flat()];
    expect(new Set(visible.map((item) => item.id)).size).toBe(visible.length);
    expect(visible).toHaveLength(4);
  });

  it("regroups moved or detached threads without mutating their history", () => {
    const history = [{ role: "user", content: "Help me draft pricing" }];
    const thread = { id: "thread", room_id: null as string | null, history };
    for (const roomId of ["a", "b", null]) {
      const moved = { ...thread, room_id: roomId };
      const grouped = groupThreads([moved]);
      expect(roomId ? grouped.byRoom.get(roomId) : grouped.general).toEqual([moved]);
      expect(moved.history).toBe(history);
      expect(thread.room_id).toBeNull();
    }
  });
});
