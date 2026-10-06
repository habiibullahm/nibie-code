import { describe, expect, it } from "vitest";
import { suppressSupersededPendingAssistants } from "../../lib/chat/optimistic";

const row = (id: string, role: "user" | "assistant", position: number) => ({
  id,
  role,
  position,
});

describe("suppressSupersededPendingAssistants", () => {
  it("keeps the optimistic thinking row until the real assistant exists", () => {
    expect(
      suppressSupersededPendingAssistants([
        row("user-1", "user", 1),
        row("pending-user-1", "assistant", 2),
      ]),
    ).toEqual([
      row("user-1", "user", 1),
      row("pending-user-1", "assistant", 2),
    ]);
  });

  it("removes the duplicate optimistic thinking row when the real assistant lands at the same position", () => {
    expect(
      suppressSupersededPendingAssistants([
        row("user-1", "user", 1),
        row("pending-user-1", "assistant", 2),
        row("11111111-1111-4111-8111-111111111111", "assistant", 2),
      ]),
    ).toEqual([
      row("user-1", "user", 1),
      row("11111111-1111-4111-8111-111111111111", "assistant", 2),
    ]);
  });

  it("does not hide pending assistants for a different position", () => {
    expect(
      suppressSupersededPendingAssistants([
        row("pending-user-1", "assistant", 2),
        row("22222222-2222-4222-8222-222222222222", "assistant", 4),
      ]),
    ).toHaveLength(2);
  });
});
