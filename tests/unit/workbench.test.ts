import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchDocumentAction, createWorkbenchFromAssistantAction, deleteWorkbenchDocumentAction, updateWorkbenchDocumentAction } from "../../app/actions/workbench";
import { canContinueInWorkbench } from "../../lib/workbench/offer";
import { beginWorkbenchSave, editWorkbenchDraft, failWorkbenchSave, initialWorkbenchEditorState, saveStatusLabel, succeedWorkbenchSave } from "../../lib/workbench/save-state";
import { workbenchTitleFromContent } from "../../lib/workbench/title";
import { parseWorkbenchCreate, parseWorkbenchWrite } from "../../lib/workbench/validation";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));

const owner = "owner";
const documentId = "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60";
const messageId = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const conversationId = "8b2c3d4e-5f60-4a1b-9c8d-7e6f5a4b3c2d";
const roomId = "9c3d4e5f-6071-4b2c-8d9e-6f5a4b3c2d1e";

type Row = Record<string, unknown>;

function memoryClient(options: { fail?: boolean; message?: Row | null; conversation?: Row | null } = {}) {
  const documents: Row[] = [];
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: owner } }, error: null }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const api = {
        select: () => api,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return api;
        },
        insert(row: Row) {
          inserts.push(row);
          const saved = { id: documentId, created_at: "2026-10-03T00:00:00.000Z", updated_at: "2026-10-03T00:00:00.000Z", ...row };
          return {
            select: () => ({
              single: async () => {
                if (options.fail) return { data: null, error: { code: "XX000" } };
                if (row.user_id !== owner) return { data: null, error: { code: "42501" } };
                documents.push(saved);
                return { data: saved, error: null };
              },
            }),
          };
        },
        update(patch: Row) {
          updates.push(patch);
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            select: () => ({
              maybeSingle: async () => {
                if (options.fail) return { data: null, error: { code: "XX000" } };
                const id = filters.find(([key]) => key === "id")?.[1];
                const userId = filters.find(([key]) => key === "user_id")?.[1];
                const existing = documents.find((doc) => doc.id === id && doc.user_id === userId);
                if (!existing) return { data: null, error: null };
                Object.assign(existing, patch, { updated_at: "2026-10-03T00:00:01.000Z" });
                return { data: { ...existing }, error: null };
              },
            }),
          };
          return chain;
        },
        delete() {
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            select: () => ({
              maybeSingle: async () => {
                if (options.fail) return { data: null, error: { code: "XX000" } };
                const id = filters.find(([key]) => key === "id")?.[1];
                const userId = filters.find(([key]) => key === "user_id")?.[1];
                const index = documents.findIndex((doc) => doc.id === id && doc.user_id === userId);
                if (index < 0) return { data: null, error: null };
                documents.splice(index, 1);
                return { data: { id }, error: null };
              },
            }),
          };
          return chain;
        },
        async maybeSingle() {
          const id = filters.find(([key]) => key === "id")?.[1];
          const userId = filters.find(([key]) => key === "user_id")?.[1];
          const source = table === "messages" ? options.message : table === "conversations" ? options.conversation : null;
          if (!source || source.id !== id || source.user_id !== userId) return { data: null, error: null };
          return { data: source, error: null };
        },
      };
      return api;
    },
  };
  return { client, documents, inserts, updates };
}

describe("workbench documents", () => {
  beforeEach(() => createClient.mockReset());

  it("creates an owned document with a nullable room", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    const created = await createWorkbenchDocumentAction({});
    expect(created.data).toMatchObject({ title: "Untitled", content: "", room_id: null, user_id: owner });
    expect(memory.inserts[0]).toEqual({ user_id: owner, title: "Untitled", content: "", room_id: null });
    const room = await createWorkbenchDocumentAction({ roomId });
    expect(room.data).toMatchObject({ room_id: roomId, user_id: owner });
  });

  it("rejects a client-supplied owner before writing", async () => {
    await expect(createWorkbenchDocumentAction({ user_id: "someone-else", title: "Notes" })).resolves.toMatchObject({ error: "Choose a valid document." });
    await expect(updateWorkbenchDocumentAction(documentId, { title: "Notes", content: "body", user_id: "someone-else" })).resolves.toMatchObject({ error: "Choose a valid document." });
    await expect(parseWorkbenchCreate({ roomId: "not-a-room" })).toEqual({ error: "Choose a valid room." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("updates the title and content without changing the owner", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    await createWorkbenchDocumentAction({ title: "Notes", content: "first" });
    const updated = await updateWorkbenchDocumentAction(documentId, { title: "Renamed", content: "second" });
    expect(updated.data).toMatchObject({ title: "Renamed", content: "second", user_id: owner });
    expect(memory.updates[0]).toEqual({ title: "Renamed", content: "second" });
    expect(memory.documents[0]).toMatchObject({ title: "Renamed", content: "second", user_id: owner });
  });

  it("deletes only the owner's document", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    await createWorkbenchDocumentAction({ title: "Notes", content: "body" });
    await expect(deleteWorkbenchDocumentAction(documentId)).resolves.toEqual({});
    expect(memory.documents).toHaveLength(0);
    await expect(deleteWorkbenchDocumentAction(documentId)).resolves.toMatchObject({ error: "That document is no longer available." });
    await expect(deleteWorkbenchDocumentAction("nope")).resolves.toMatchObject({ error: "Choose a valid document." });
  });

  it("keeps the unsaved draft visible when a save fails", async () => {
    const memory = memoryClient({ fail: true });
    createClient.mockResolvedValue(memory.client);
    await createWorkbenchDocumentAction({ title: "Notes", content: "saved" });
    const draft = { title: "Notes", content: "Keep this sentence." };
    let state = editWorkbenchDraft(initialWorkbenchEditorState({ title: "Notes", content: "saved" }), draft);
    state = beginWorkbenchSave(state);
    expect(saveStatusLabel(state)).toBe("Saving…");
    const result = await updateWorkbenchDocumentAction(documentId, draft);
    expect(result.error).toBeTruthy();
    state = failWorkbenchSave(state, result.error ?? "");
    expect(state.draft).toEqual(draft);
    expect(saveStatusLabel(state)).toBe("Save failed");
    expect(state.persisted).toEqual({ title: "Notes", content: "saved" });
    state = succeedWorkbenchSave(editWorkbenchDraft(state, draft), draft);
    expect(saveStatusLabel(state)).toBe("Saved");
    state = editWorkbenchDraft(state, { title: "Notes", content: "Keep this sentence. And more." });
    state = succeedWorkbenchSave(state, draft);
    expect(state.draft.content).toBe("Keep this sentence. And more.");
    expect(saveStatusLabel(state)).toBeNull();
  });

  it("names a document from the response without calling a model", () => {
    expect(workbenchTitleFromContent("# A calm plan\n\nMore text")).toBe("A calm plan");
    expect(workbenchTitleFromContent("\n\n   ")).toBe("Untitled");
    expect(workbenchTitleFromContent(`x${"y".repeat(200)}`)).toHaveLength(120);
    const empty = parseWorkbenchWrite({ title: "Notes", content: "" });
    expect(empty).toEqual({ data: { title: "Notes", content: "" } });
  });

  it("offers Workbench only for a finished assistant response", () => {
    expect(canContinueInWorkbench({ role: "assistant", status: "complete", content: "A finished answer." })).toBe(true);
    expect(canContinueInWorkbench({ role: "assistant", status: "streaming", content: "partial" })).toBe(false);
    expect(canContinueInWorkbench({ role: "assistant", status: "interrupted", content: "Response stopped." })).toBe(false);
    expect(canContinueInWorkbench({ role: "assistant", status: "error", content: "Response unavailable." })).toBe(false);
    expect(canContinueInWorkbench({ role: "assistant", status: "complete", content: "Response unavailable." })).toBe(false);
    expect(canContinueInWorkbench({ role: "user", status: "complete", content: "Hello" })).toBe(false);
    expect(canContinueInWorkbench({ role: "assistant", content: "No status yet" })).toBe(false);
  });

  it("creates a document from a finished assistant response and keeps the room optional", async () => {
    const withRoom = memoryClient({
      message: { id: messageId, user_id: owner, role: "assistant", status: "complete", content: "# Room notes\n\nKeep this.", conversation_id: conversationId },
      conversation: { id: conversationId, user_id: owner, room_id: roomId },
    });
    createClient.mockResolvedValue(withRoom.client);
    const created = await createWorkbenchFromAssistantAction(messageId);
    expect(created.data).toEqual({ id: documentId });
    expect(withRoom.inserts[0]).toMatchObject({ user_id: owner, title: "Room notes", content: "# Room notes\n\nKeep this.", room_id: roomId });

    const general = memoryClient({
      message: { id: messageId, user_id: owner, role: "assistant", status: "complete", content: "General answer", conversation_id: conversationId },
      conversation: { id: conversationId, user_id: owner, room_id: null },
    });
    createClient.mockResolvedValue(general.client);
    await createWorkbenchFromAssistantAction(messageId);
    expect(general.inserts[0]).toMatchObject({ room_id: null, title: "General answer" });

    const streaming = memoryClient({
      message: { id: messageId, user_id: owner, role: "assistant", status: "streaming", content: "partial", conversation_id: conversationId },
      conversation: { id: conversationId, user_id: owner, room_id: null },
    });
    createClient.mockResolvedValue(streaming.client);
    await expect(createWorkbenchFromAssistantAction(messageId)).resolves.toMatchObject({ error: "Only a finished response can be opened in Workbench." });
    expect(streaming.inserts).toHaveLength(0);
  });

  it("strips internal reasoning before a Workbench handoff", async () => {
    const client = memoryClient({
      message: {
        id: messageId,
        user_id: owner,
        role: "assistant",
        status: "complete",
        content: "<think>\nsecret reasoning\n</think>\n\n# AI Assistant Proposal for Clinic\n\n## Confirmed Context\n\nClinic information and patient support.",
        conversation_id: conversationId,
      },
      conversation: { id: conversationId, user_id: owner, room_id: roomId },
    });
    createClient.mockResolvedValue(client.client);
    const created = await createWorkbenchFromAssistantAction(messageId);
    expect(created.data).toEqual({ id: documentId });
    expect(client.inserts[0]).toMatchObject({
      title: "AI Assistant Proposal for Clinic",
      room_id: roomId,
    });
    const content = String(client.inserts[0]?.content);
    expect(content.startsWith("# AI Assistant Proposal for Clinic")).toBe(true);
    expect(content).not.toContain("<think");
    expect(content).not.toContain("secret reasoning");
  });
});
