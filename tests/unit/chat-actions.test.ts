import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, modelOptions } = vi.hoisted(() => ({ createClient: vi.fn(), modelOptions: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/ai/registry", () => ({ getModelOptions: modelOptions }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addUserMessageAction, createConversationAction, deleteConversationAction, editLastUserMessageAction, renameConversationAction, startConversationAction, updateConversationModelAction } from "../../app/actions/chat";

describe("chat server action input boundaries", () => {
  beforeEach(() => { createClient.mockReset(); modelOptions.mockReset().mockReturnValue({ models: [{ id: "Fast" }, { id: "Balanced" }] }); });

  it("rejects unsupported models before opening an authenticated client", async () => {
    await expect(createConversationAction("default")).resolves.toEqual({ error: "Choose a valid response mode." });
    await expect(updateConversationModelAction("5e9bdcca-9205-4fea-a773-13952bb78c44", "unknown")).resolves.toEqual({ error: "Choose a valid response mode." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a mode that is not configured on the server before opening an authenticated client", async () => {
    await expect(createConversationAction("High")).resolves.toEqual({ error: "That model isn't available." });
    await expect(updateConversationModelAction("5e9bdcca-9205-4fea-a773-13952bb78c44", "High")).resolves.toEqual({ error: "That model isn't available." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves a configured mode on the conversation", async () => {
    const eq = vi.fn(() => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "c" }, error: null }) }) }));
    const update = vi.fn(() => ({ eq }));
    createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) }, from: () => ({ update }) });
    await expect(updateConversationModelAction("5e9bdcca-9205-4fea-a773-13952bb78c44", "Fast")).resolves.toEqual({});
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ selected_model: "Fast" }));
  });

  it("rejects malformed IDs and invalid message/title content before database access", async () => {
    await expect(addUserMessageAction("someone-elses-id", "hello")).resolves.toMatchObject({ error: expect.any(String) });
    await expect(addUserMessageAction("5e9bdcca-9205-4fea-a773-13952bb78c44", " ")).resolves.toMatchObject({ error: expect.any(String) });
    await expect(renameConversationAction("5e9bdcca-9205-4fea-a773-13952bb78c44", " ")).resolves.toMatchObject({ error: expect.any(String) });
    await expect(deleteConversationAction("not-a-uuid")).resolves.toMatchObject({ error: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("validates edit input before database access and maps the RPC outcomes to safe messages", async () => {
    const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
    const message = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
    await expect(editLastUserMessageAction("bad", message, "hello")).resolves.toMatchObject({ error: expect.any(String) });
    await expect(editLastUserMessageAction(conversation, "bad", "hello")).resolves.toMatchObject({ error: expect.any(String) });
    await expect(editLastUserMessageAction(conversation, message, "   ")).resolves.toMatchObject({ error: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
    const rpc = vi.fn(() => ({ single: async () => ({ data: { id: message, position: 1 }, error: null }) }));
    createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) }, rpc });
    expect(await editLastUserMessageAction(conversation, message, " edited ")).toEqual({ data: { id: message, position: 1 } });
    expect(rpc).toHaveBeenCalledWith("edit_last_user_message", { p_conversation_id: conversation, p_message_id: message, p_content: "edited" });
    for (const code of ["PT409", "PT404", "XX000"]) {
      const failing = vi.fn(() => ({ single: async () => ({ data: null, error: { code, message: "internal detail must not leak" } }) }));
      createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) }, rpc: failing });
      const result = await editLastUserMessageAction(conversation, message, "edited");
      expect(result.data).toBeUndefined();
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("internal detail");
    }
  });

  it("passes a stable submission id to the transactional append RPC", async () => {
    const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
    const message = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
    const rpc = vi.fn(() => ({ single: async () => ({ data: { id: message, position: 1 }, error: null }) }));
    createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) }, rpc });
    expect(await addUserMessageAction(conversation, " hello ", message)).toEqual({ data: { id: message, position: 1 } });
    expect(rpc).toHaveBeenCalledWith("append_user_message", { p_conversation_id: conversation, p_message_id: message, p_content: "hello" });
  });

  describe("startConversationAction (first message of a new chat in one round trip)", () => {
    const conversation = { id: "5e9bdcca-9205-4fea-a773-13952bb78c44", title: "New chat", selected_model: "Balanced", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    const message = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
    const signedIn = { getClaims: async () => ({ data: { claims: { sub: "owner" } }, error: null }) };
    function stack(append: { data: unknown; error: unknown }) {
      const calls: string[] = [];
      const removed = vi.fn<(...args: unknown[]) => Promise<{ error: null }>>(async () => ({ error: null }));
      const insert = vi.fn((row: unknown) => { calls.push("insert"); return { select: () => ({ single: async () => ({ data: conversation, error: null }) }), row }; });
      const rpc = vi.fn(() => { calls.push("append"); return { single: async () => append }; });
      const client = { auth: signedIn, from: vi.fn(() => ({ insert, delete: () => ({ eq: (...args: unknown[]) => { calls.push("delete"); return { then: (resolve: (v: unknown) => unknown) => removed(...args).then(resolve) }; } }) })), rpc };
      createClient.mockResolvedValue(client);
      return { calls, insert, rpc, removed };
    }

    it("validates input and the configured model before opening an authenticated client", async () => {
      await expect(startConversationAction("default", message, "hello")).resolves.toEqual({ error: "Choose a valid response mode." });
      await expect(startConversationAction("Balanced", "bad", "hello")).resolves.toEqual({ error: "Choose a valid message." });
      await expect(startConversationAction("Balanced", message, "  ")).resolves.toMatchObject({ error: expect.any(String) });
      await expect(startConversationAction("High", message, "hello")).resolves.toEqual({ error: "That model isn't available." });
      expect(createClient).not.toHaveBeenCalled();
    });

    it("creates the conversation for the signed-in owner and saves the message, returning both", async () => {
      const { calls, insert, rpc } = stack({ data: { id: message, position: 1 }, error: null });
      await expect(startConversationAction("Balanced", message, " hello ")).resolves.toEqual({ data: { conversation, message: { id: message, position: 1 } } });
      expect(calls).toEqual(["insert", "append"]);
      expect(insert).toHaveBeenCalledWith({ user_id: "owner", title: "New chat", selected_model: "Balanced" });
      expect(rpc).toHaveBeenCalledWith("append_user_message", { p_conversation_id: conversation.id, p_message_id: message, p_content: "hello" });
    });

    it("removes the empty conversation again when the message cannot be saved, without leaking details", async () => {
      const { calls, removed } = stack({ data: null, error: { code: "XX000", message: "internal detail must not leak" } });
      const result = await startConversationAction("Balanced", message, "hello");
      expect(result.data).toBeUndefined();
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("internal detail");
      expect(calls).toEqual(["insert", "append", "delete"]);
      expect(removed).toHaveBeenCalledWith("id", conversation.id);
    });

    it("reports an expired session without touching the database", async () => {
      createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: null, error: new Error("expired") }) }, from: vi.fn() });
      await expect(startConversationAction("Balanced", message, "hello")).resolves.toEqual({ error: "Your session has expired or the service is unavailable. Please try again." });
    });
  });
});
