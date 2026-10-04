import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));

import { deleteAllConversationsAction } from "../../app/actions/privacy";
import { isDeleteAllConfirmed } from "../../lib/privacy/confirmation";

describe("delete-all confirmation", () => {
  it("accepts only the exact DELETE phrase", () => {
    expect(isDeleteAllConfirmed("DELETE")).toBe(true);
    expect(isDeleteAllConfirmed(" DELETE ")).toBe(true);
    for (const value of ["delete", "Delete", "DELETED", "", "DELETE ACCOUNT", " DELETE\nnow", null, undefined, { userId: "other" }]) {
      expect(isDeleteAllConfirmed(value)).toBe(false);
    }
  });
});

describe("deleteAllConversationsAction", () => {
  beforeEach(() => { createClient.mockReset(); });

  function clientFor(userId: string | null) {
    const tables: string[] = [];
    const filters: Array<[string, string]> = [];
    const builder = {
      eq: vi.fn((column: string, value: string) => { filters.push([column, value]); return builder; }),
      is: vi.fn((column: string, value: null) => { filters.push([column, String(value)]); return builder; }),
      select: vi.fn(() => builder),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "conversation" }], error: null }).then(resolve),
    };
    const from = vi.fn((table: string) => { tables.push(table); return { delete: () => builder }; });
    createClient.mockResolvedValue({
      auth: { getClaims: async () => (userId ? { data: { claims: { sub: userId } }, error: null } : { data: null, error: new Error("no session") }) },
      from,
    });
    return { from, filters, tables };
  }

  it("does nothing until the phrase is confirmed", async () => {
    const { from } = clientFor("owner");
    await expect(deleteAllConversationsAction("delete")).resolves.toEqual({ error: "Type DELETE to confirm." });
    await expect(deleteAllConversationsAction({ confirmation: "DELETE", userId: "someone-else" })).resolves.toEqual({ error: "Type DELETE to confirm." });
    expect(from).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("deletes only the signed-in owner's conversations and ignores any other id", async () => {
    const { from, filters, tables } = clientFor("owner-a");
    const action = deleteAllConversationsAction as (confirmation: unknown, userId?: string) => ReturnType<typeof deleteAllConversationsAction>;
    await expect(action("DELETE", "owner-b")).resolves.toEqual({ deletedCount: 1 });
    // Conversations (with their messages and sent attachments, by cascade), then only this owner's unsent drafts.
    expect(tables).toEqual(["conversations", "message_attachments"]);
    expect(filters).toEqual([["user_id", "owner-a"], ["user_id", "owner-a"], ["message_id", "null"]]);
    expect(from).not.toHaveBeenCalledWith("messages");
    expect(from).not.toHaveBeenCalledWith("users");
    expect(from).not.toHaveBeenCalledWith("user_preferences");
    expect(filters.some(([, value]) => value === "owner-b")).toBe(false);
  });

  it("fails closed when the session is missing and does not delete", async () => {
    const { from } = clientFor(null);
    await expect(deleteAllConversationsAction("DELETE")).resolves.toEqual({ error: "Your session has expired or the service is unavailable. Please try again." });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not report success when the delete fails", async () => {
    const builder = {
      eq: () => builder,
      select: () => builder,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "internal detail must not leak" } }).then(resolve),
    };
    createClient.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: "owner-a" } }, error: null }) },
      from: () => ({ delete: () => builder }),
    });
    const result = await deleteAllConversationsAction("DELETE");
    expect(result.deletedCount).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("internal detail");
  });
});
