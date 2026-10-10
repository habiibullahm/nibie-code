import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkbenchDocumentAction,
  createWorkbenchFromAssistantAction,
  createWorkbenchVersionAction,
  deleteWorkbenchDocumentAction,
  listWorkbenchVersionsAction,
  restoreWorkbenchVersionAction,
  updateWorkbenchDocumentAction,
} from "../../app/actions/workbench";
import {
  workbenchExportContentDisposition,
  workbenchExportFilename,
  workbenchMarkdownExportBody,
  workbenchPlainExportBody,
} from "../../lib/workbench/export";
import { workbenchLineDiff } from "../../lib/workbench/diff";
import { WORKBENCH_UI_ENABLED } from "../../lib/workbench/flags";
import { canContinueInWorkbench } from "../../lib/workbench/offer";
import { applySelectionReplacement, parseWorkbenchSuggestion, workbenchReviseMessages } from "../../lib/workbench/prompt";
import { getWorkbenchDocument } from "../../lib/workbench/read";
import {
  applyWorkbenchAiProposal,
  beginWorkbenchAiGenerate,
  cancelWorkbenchAi,
  canApplyWorkbenchAiProposal,
  completeWorkbenchAiProposal,
  discardWorkbenchAiProposal,
  failWorkbenchAi,
  initialWorkbenchAiState,
  openWorkbenchAiPrompt,
  setWorkbenchAiInstruction,
} from "../../lib/workbench/revision";
import {
  beginWorkbenchSave,
  conflictWorkbenchSave,
  editWorkbenchDraft,
  failWorkbenchSave,
  initialWorkbenchEditorState,
  saveStatusLabel,
  succeedWorkbenchSave,
} from "../../lib/workbench/save-state";
import { workbenchTitleFromContent } from "../../lib/workbench/title";
import { workbenchVersionLimit } from "../../lib/workbench/types";
import { parseWorkbenchCreate, parseWorkbenchWrite } from "../../lib/workbench/validation";
import { shouldSkipDuplicateVersion, versionIdsToPrune } from "../../lib/workbench/versions";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));

const owner = "owner";
const documentId = "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60";
const messageId = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const conversationId = "8b2c3d4e-5f60-4a1b-9c8d-7e6f5a4b3c2d";
const roomId = "9c3d4e5f-6071-4b2c-8d9e-6f5a4b3c2d1e";
const missingRevision = { code: "PGRST204" };

type Row = Record<string, unknown>;

function projectRow(row: Row, columns: string) {
  const keys = columns.split(",");
  const projected: Row = {};
  for (const key of keys) projected[key] = row[key];
  return projected;
}

function memoryClient(options: {
  fail?: boolean;
  revisionMissing?: boolean;
  versionsMissing?: boolean;
  message?: Row | null;
  conversation?: Row | null;
  seed?: Row[];
  versionSeed?: Row[];
} = {}) {
  const documents: Row[] = [...(options.seed ?? [])];
  const versions: Row[] = [...(options.versionSeed ?? [])];
  const inserts: Row[] = [];
  const updates: Row[] = [];
  let versionSeq = 0;
  const matches = (row: Row) => filters.every(([key, value]) => {
    if (Array.isArray(value)) return value.includes(row[key]);
    return row[key] === value;
  });
  let filters: Array<[string, unknown]> = [];
  let selectColumns = "";
  let orderBy: { column: string; ascending: boolean } | null = null;
  let limitCount: number | null = null;

  function resetQuery() {
    filters = [];
    selectColumns = "";
    orderBy = null;
    limitCount = null;
  }

  function applyList(rows: Row[]) {
    let next = rows.filter(matches);
    if (orderBy) {
      const { column, ascending } = orderBy;
      next = [...next].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (limitCount != null) next = next.slice(0, limitCount);
    return next;
  }

  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: owner } }, error: null }) },
    from(table: string) {
      resetQuery();
      const api = {
        select(columns = "") {
          selectColumns = columns;
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return api;
        },
        in(column: string, value: unknown[]) {
          filters.push([column, value]);
          return api;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          orderBy = { column, ascending: opts?.ascending !== false };
          return api;
        },
        limit(count: number) {
          limitCount = count;
          return api;
        },
        insert(row: Row) {
          if (table === "workbench_document_versions") {
            versionSeq += 1;
            const saved = {
              id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(versionSeq).padStart(12, "0")}`,
              created_at: `2026-10-03T00:00:${String(versionSeq).padStart(2, "0")}.000Z`,
              revision_run_id: null,
              ...row,
            };
            return {
              select(columns: string) {
                return {
                  single: async () => {
                    if (options.fail) return { data: null, error: { code: "XX000" } };
                    if (options.versionsMissing) return { data: null, error: missingRevision };
                    if (row.user_id !== owner) return { data: null, error: { code: "42501" } };
                    inserts.push(row);
                    versions.push(saved);
                    return { data: projectRow(saved, columns), error: null };
                  },
                };
              },
            };
          }
          const saved = {
            id: documentId,
            ...(options.revisionMissing ? {} : { revision: 1 }),
            created_at: "2026-10-03T00:00:00.000Z",
            updated_at: "2026-10-03T00:00:00.000Z",
            ...row,
          };
          return {
            select(columns: string) {
              return {
                single: async () => {
                  if (options.fail) return { data: null, error: { code: "XX000" } };
                  if (options.revisionMissing && columns.includes("revision")) return { data: null, error: missingRevision };
                  if (row.user_id !== owner) return { data: null, error: { code: "42501" } };
                  inserts.push(row);
                  documents.push(saved);
                  return { data: projectRow(saved, columns), error: null };
                },
              };
            },
          };
        },
        update(patch: Row) {
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            select(columns: string) {
              return {
                maybeSingle: async () => {
                  if (options.fail) return { data: null, error: { code: "XX000" } };
                  if (options.revisionMissing && ("revision" in patch || columns.includes("revision") || filters.some(([key]) => key === "revision"))) {
                    updates.push(patch);
                    return { data: null, error: missingRevision };
                  }
                  const id = filters.find(([key]) => key === "id")?.[1];
                  const userId = filters.find(([key]) => key === "user_id")?.[1];
                  const expectedRevision = filters.find(([key]) => key === "revision")?.[1];
                  const existing = documents.find((doc) => doc.id === id && doc.user_id === userId);
                  if (!existing) return { data: null, error: null };
                  if (expectedRevision !== undefined && existing.revision !== expectedRevision) return { data: null, error: null };
                  updates.push(patch);
                  Object.assign(existing, patch, { updated_at: "2026-10-03T00:00:01.000Z" });
                  return { data: projectRow(existing, columns), error: null };
                },
              };
            },
          };
          return chain;
        },
        delete() {
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            in(column: string, value: unknown[]) {
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
            then(resolve: (value: { data: null; error: null }) => unknown) {
              if (table === "workbench_document_versions") {
                for (let i = versions.length - 1; i >= 0; i -= 1) {
                  if (matches(versions[i]!)) versions.splice(i, 1);
                }
              }
              return Promise.resolve(resolve({ data: null, error: null }));
            },
          };
          return chain;
        },
        async maybeSingle() {
          const id = filters.find(([key]) => key === "id")?.[1];
          const userId = filters.find(([key]) => key === "user_id")?.[1];
          if (table === "workbench_document_versions") {
            if (options.versionsMissing) return { data: null, error: missingRevision };
            const existing = applyList(versions)[0];
            if (!existing) return { data: null, error: null };
            return { data: selectColumns ? projectRow(existing, selectColumns) : { ...existing }, error: null };
          }
          if (table === "workbench_documents") {
            if (options.revisionMissing && selectColumns.includes("revision")) {
              return { data: null, error: missingRevision };
            }
            const existing = documents.find((doc) => doc.id === id && (!userId || doc.user_id === userId));
            if (!existing) return { data: null, error: null };
            return {
              data: selectColumns ? projectRow(existing, selectColumns) : { ...existing },
              error: null,
            };
          }
          if (table === "rooms") {
            return { data: null, error: null };
          }
          const source = table === "messages" ? options.message : table === "conversations" ? options.conversation : null;
          if (!source || source.id !== id || source.user_id !== userId) return { data: null, error: null };
          return { data: source, error: null };
        },
        then(resolve: (value: { data: Row[] | null; error: { code: string } | null }) => unknown) {
          if (table === "workbench_document_versions") {
            if (options.versionsMissing) return Promise.resolve(resolve({ data: null, error: missingRevision }));
            const rows = applyList(versions).map((row) => (selectColumns ? projectRow(row, selectColumns) : { ...row }));
            return Promise.resolve(resolve({ data: rows, error: null }));
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      };
      return api;
    },
  };
  return { client, documents, versions, inserts, updates };
}

describe("workbench documents", () => {
  beforeEach(() => createClient.mockReset());

  it("creates an owned document with a nullable room", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    const created = await createWorkbenchDocumentAction({});
    expect(created.data).toMatchObject({ title: "Untitled", content: "", room_id: null, revision: 1 });
    expect(memory.inserts[0]).toEqual({ user_id: owner, title: "Untitled", content: "", room_id: null });
    const room = await createWorkbenchDocumentAction({ roomId });
    expect(room.data).toMatchObject({ room_id: roomId, revision: 1 });
  });

  it("rejects a client-supplied owner before writing", async () => {
    await expect(createWorkbenchDocumentAction({ user_id: "someone-else", title: "Notes" })).resolves.toMatchObject({ error: "Choose a valid document." });
    await expect(updateWorkbenchDocumentAction(documentId, { title: "Notes", content: "body", expectedRevision: 1, user_id: "someone-else" })).resolves.toMatchObject({ error: "Choose a valid document." });
    await expect(parseWorkbenchCreate({ roomId: "not-a-room" })).toEqual({ error: "Choose a valid room." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("updates with expected revision and rejects stale writes", async () => {
    const memory = memoryClient();
    createClient.mockResolvedValue(memory.client);
    await createWorkbenchDocumentAction({ title: "Notes", content: "first" });
    const updated = await updateWorkbenchDocumentAction(documentId, { title: "Renamed", content: "second", expectedRevision: 1 });
    expect(updated.data).toMatchObject({ title: "Renamed", content: "second", revision: 2 });
    expect(memory.updates[0]).toEqual({ title: "Renamed", content: "second", revision: 2 });
    const stale = await updateWorkbenchDocumentAction(documentId, { title: "Stale", content: "nope", expectedRevision: 1 });
    expect(stale).toMatchObject({ conflict: true });
    expect(memory.documents[0]).toMatchObject({ title: "Renamed", content: "second", revision: 2 });
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
    let state = editWorkbenchDraft(initialWorkbenchEditorState({ title: "Notes", content: "saved" }, 1), draft);
    state = beginWorkbenchSave(state);
    expect(saveStatusLabel(state)).toBe("Saving…");
    const result = await updateWorkbenchDocumentAction(documentId, { ...draft, expectedRevision: 1 });
    expect(result.error).toBeTruthy();
    state = failWorkbenchSave(state, result.error ?? "");
    expect(state.draft).toEqual(draft);
    expect(saveStatusLabel(state)).toBe("Save failed");
    expect(state.persisted).toEqual({ title: "Notes", content: "saved" });
    state = succeedWorkbenchSave(editWorkbenchDraft(state, draft), draft, 2);
    expect(saveStatusLabel(state)).toBe("Saved");
    state = editWorkbenchDraft(state, { title: "Notes", content: "Keep this sentence. And more." });
    state = succeedWorkbenchSave(state, draft, 2);
    expect(state.draft.content).toBe("Keep this sentence. And more.");
    expect(saveStatusLabel(state)).toBeNull();
    state = conflictWorkbenchSave(state);
    expect(saveStatusLabel(state)).toBe("Newer version saved elsewhere");
  });

  it("names a document from the response without calling a model", () => {
    expect(workbenchTitleFromContent("# A calm plan\n\nMore text")).toBe("A calm plan");
    expect(workbenchTitleFromContent("\n\n   ")).toBe("Untitled");
    expect(workbenchTitleFromContent(`x${"y".repeat(200)}`)).toHaveLength(120);
    const empty = parseWorkbenchWrite({ title: "Notes", content: "", expectedRevision: 1 });
    expect(empty).toEqual({ data: { title: "Notes", content: "", expectedRevision: 1 } });
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

  it("keeps Workbench UI disabled until product-ready", () => {
    expect(WORKBENCH_UI_ENABLED).toBe(false);
  });

  it("loads a document when migration 0027 revision is undeployed", async () => {
    const memory = memoryClient({
      revisionMissing: true,
      seed: [{
        id: documentId,
        user_id: owner,
        title: "From chat",
        content: "Body",
        room_id: null,
        created_at: "2026-10-03T00:00:00.000Z",
        updated_at: "2026-10-03T00:00:00.000Z",
      }],
    });
    createClient.mockResolvedValue(memory.client);
    await expect(getWorkbenchDocument(documentId)).resolves.toMatchObject({
      error: null,
      document: { id: documentId, title: "From chat", content: "Body", revision: 1, room_name: null },
    });
  });

  it("creates and updates without revision when the column is undeployed", async () => {
    const memory = memoryClient({ revisionMissing: true });
    createClient.mockResolvedValue(memory.client);
    const created = await createWorkbenchDocumentAction({ title: "Notes", content: "first" });
    expect(created.data).toMatchObject({ title: "Notes", content: "first", revision: 1 });
    expect(memory.inserts).toHaveLength(1);
    const updated = await updateWorkbenchDocumentAction(documentId, { title: "Notes", content: "second", expectedRevision: 1 });
    expect(updated.data).toMatchObject({ title: "Notes", content: "second", revision: 1 });
    expect(memory.updates[0]).toEqual({ title: "Notes", content: "second", revision: 2 });
    expect(memory.updates[1]).toEqual({ title: "Notes", content: "second" });
    expect(memory.documents[0]).toMatchObject({ title: "Notes", content: "second" });
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

describe("workbench AI revision state", () => {
  it("moves through prompt, generate, inline apply, cancel, and fail", () => {
    let state = initialWorkbenchAiState();
    state = openWorkbenchAiPrompt(state);
    state = setWorkbenchAiInstruction(state, "Tighten the intro");
    state = beginWorkbenchAiGenerate(state, {
      original: { title: "Notes", content: "One\nTwo" },
      expectedRevision: 3,
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(state.phase).toBe("generating");
    expect(canApplyWorkbenchAiProposal(state)).toBe(false);
    state = completeWorkbenchAiProposal(state, { title: "Notes", content: "One\nTwo\nThree" });
    expect(state.phase).toBe("applying");
    expect(canApplyWorkbenchAiProposal(state)).toBe(true);
    state = applyWorkbenchAiProposal(state);
    expect(state.phase).toBe("idle");

    state = beginWorkbenchAiGenerate(openWorkbenchAiPrompt(setWorkbenchAiInstruction(initialWorkbenchAiState(), "Again")), {
      original: { title: "Notes", content: "A" },
      expectedRevision: 1,
      runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    state = cancelWorkbenchAi(state);
    expect(state.phase).toBe("cancelled");
    expect(canApplyWorkbenchAiProposal(state)).toBe(false);

    state = failWorkbenchAi(beginWorkbenchAiGenerate(openWorkbenchAiPrompt(setWorkbenchAiInstruction(initialWorkbenchAiState(), "Retry")), {
      original: { title: "Notes", content: "A" },
      expectedRevision: 1,
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }), "Provider failed");
    expect(state.phase).toBe("failed");
    expect(discardWorkbenchAiProposal().phase).toBe("idle");
  });

  it("rejects incomplete proposals and empty suggestions", () => {
    expect(parseWorkbenchSuggestion("", "Title")).toBeNull();
    expect(parseWorkbenchSuggestion("  ", "Title")).toBeNull();
    expect(parseWorkbenchSuggestion("Improved body", "Title")).toEqual({ title: "Title", content: "Improved body" });
    const incomplete = beginWorkbenchAiGenerate(setWorkbenchAiInstruction(openWorkbenchAiPrompt(initialWorkbenchAiState()), "Go"), {
      original: { title: "T", content: "A" },
      expectedRevision: 1,
      runId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    expect(canApplyWorkbenchAiProposal(incomplete)).toBe(false);
  });

  it("builds a simple line diff for edit comparison", () => {
    expect(workbenchLineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("splices a revised selection into the document and builds a selection prompt", () => {
    const content = "Hello world — keep this.";
    const selection = { start: 6, end: 11, text: "world" };
    expect(applySelectionReplacement(content, selection, "planet")).toBe("Hello planet — keep this.");
    expect(applySelectionReplacement(content, { ...selection, text: "wrong" }, "planet")).toBeNull();
    expect(applySelectionReplacement(content, { start: 0, end: 999, text: content }, "x")).toBeNull();

    const messages = workbenchReviseMessages({
      instruction: "Make it stronger",
      document: { title: "Notes", content },
      selection,
    });
    expect(messages[0]?.content).toContain("replacement text for that selection");
    expect(messages[1]?.content).toContain("Selected text:\nworld");
    expect(messages[1]?.content).toContain("Full document (context only");
  });
});

describe("workbench versions and export", () => {
  beforeEach(() => createClient.mockReset());

  it("skips duplicate snapshots and prunes oldest ids beyond the retention limit", () => {
    expect(shouldSkipDuplicateVersion({ title: "A", content: "1" }, { title: "A", content: "1" })).toBe(true);
    expect(shouldSkipDuplicateVersion({ title: "A", content: "1" }, { title: "A", content: "2" })).toBe(false);
    expect(shouldSkipDuplicateVersion(null, { title: "A", content: "1" })).toBe(false);
    const ids = Array.from({ length: workbenchVersionLimit + 3 }, (_, index) => `id-${index}`);
    expect(versionIdsToPrune(ids)).toEqual(["id-50", "id-51", "id-52"]);
    expect(versionIdsToPrune(ids.slice(0, workbenchVersionLimit))).toEqual([]);
  });

  it("builds safe Markdown and plain export payloads", () => {
    expect(workbenchExportFilename("Clinic notes / v1", "md")).toBe("Clinic-notes-v1.md");
    expect(workbenchExportFilename("  ", "txt")).toBe("Untitled.txt");
    expect(workbenchExportContentDisposition("Café.md")).toContain('filename="Caf_.md"');
    expect(workbenchExportContentDisposition("Café.md")).toContain("filename*=UTF-8''Caf%C3%A9.md");
    expect(workbenchPlainExportBody("line\r\none")).toBe("line\none");
    expect(workbenchMarkdownExportBody("Notes", "Hello")).toBe("# Notes\n\nHello\n");
    expect(workbenchMarkdownExportBody("Notes", "## Already\n\nBody")).toBe("## Already\n\nBody\n");
  });

  it("creates a manual version checkpoint without changing the live document revision", async () => {
    const memory = memoryClient({
      seed: [{
        id: documentId,
        user_id: owner,
        title: "Notes",
        content: "first draft",
        revision: 2,
        room_id: null,
        created_at: "2026-10-03T00:00:00.000Z",
        updated_at: "2026-10-03T00:00:00.000Z",
      }],
    });
    createClient.mockResolvedValue(memory.client);
    const created = await createWorkbenchVersionAction({ documentId, expectedRevision: 2 });
    expect(created.data).toMatchObject({ source: "manual", title: "Notes", content: "first draft", document_revision: 2 });
    expect(memory.versions).toHaveLength(1);
    expect(memory.documents[0]).toMatchObject({ revision: 2, content: "first draft" });
    const listed = await listWorkbenchVersionsAction(documentId);
    expect(listed.data).toHaveLength(1);
    const duplicate = await createWorkbenchVersionAction({ documentId, expectedRevision: 2 });
    expect(duplicate.data?.id).toBe(created.data?.id);
    expect(memory.versions).toHaveLength(1);
  });

  it("restores a prior version after saving the current text as a recoverable snapshot", async () => {
    const memory = memoryClient({
      seed: [{
        id: documentId,
        user_id: owner,
        title: "Current",
        content: "newer body",
        revision: 3,
        room_id: null,
        created_at: "2026-10-03T00:00:00.000Z",
        updated_at: "2026-10-03T00:00:00.000Z",
      }],
      versionSeed: [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        user_id: owner,
        document_id: documentId,
        source: "manual",
        title: "Older",
        content: "older body",
        document_revision: 1,
        revision_run_id: null,
        created_at: "2026-10-02T00:00:00.000Z",
      }],
    });
    createClient.mockResolvedValue(memory.client);
    const restored = await restoreWorkbenchVersionAction({
      documentId,
      versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedRevision: 3,
    });
    expect(restored.data).toMatchObject({ title: "Older", content: "older body", revision: 4 });
    expect(memory.versions.some((row) => row.title === "Current" && row.content === "newer body")).toBe(true);
    expect(memory.documents[0]).toMatchObject({ title: "Older", content: "older body", revision: 4 });
  });
});
