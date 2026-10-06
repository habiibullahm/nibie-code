import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../../lib/context/build-context";
import { CONTEXT_POLICY_TEXT } from "../../lib/context/context-policy";
import type { BuildContextInput } from "../../lib/context/context-types";
import { toProviderMessages } from "../../lib/ai/provider-messages";
import { buildRoomFilePath, displayFileName, fileDeletionOutcome, inspectRoomFile, parseSelectedFileIds } from "../../lib/files/inspect";
import { MAX_EXTRACTED_CHARS, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE } from "../../lib/files/limits";
import { deleteRoomFile, saveRoomFile, type RoomFileClient } from "../../lib/files/service";
import { defaultUserPreferences } from "../../lib/preferences/types";

const owner = "11111111-1111-4111-8111-111111111111";
const room = "22222222-2222-4222-8222-222222222222";
const file = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";

function textFile(name: string, mime: string, text: string) {
  return { filename: name, mimeType: mime, bytes: new TextEncoder().encode(text) };
}

function accepted(result: ReturnType<typeof inspectRoomFile>) {
  if ("error" in result) throw new Error(result.error);
  return result;
}

function rejected(result: ReturnType<typeof inspectRoomFile>) {
  if (!("error" in result)) throw new Error("expected a rejected file");
  return result;
}

function input(overrides: Partial<BuildContextInput> = {}): BuildContextInput {
  return {
    capabilities: { contextWindowTokens: 16_384, maxOutputTokens: 2_048 },
    preferences: defaultUserPreferences(),
    preferenceReadFailed: false,
    summary: null,
    messages: [{ role: "user", content: "hello", position: 1 }],
    currentPosition: 1,
    ...overrides,
  };
}

describe("room file inspection", () => {
  it("accepts txt, md, and csv when the type and the bytes agree", () => {
    expect(accepted(inspectRoomFile(textFile("notes.txt", "text/plain", "hello")))).toMatchObject({ displayName: "notes.txt", mimeType: "text/plain", text: "hello" });
    expect(accepted(inspectRoomFile(textFile("notes.md", "text/markdown", "# Hello"))).mimeType).toBe("text/markdown");
    expect(accepted(inspectRoomFile(textFile("notes.md", "text/x-markdown; charset=utf-8", "# Hello"))).mimeType).toBe("text/markdown");
    expect(accepted(inspectRoomFile(textFile("sheet.csv", "text/csv", "a,b\n1,2"))).mimeType).toBe("text/csv");
    expect(accepted(inspectRoomFile(textFile("notes.md", "application/octet-stream", "# Hello"))).text).toBe("# Hello");
  });

  it("rejects a declared type that does not match the extension, and binary content", () => {
    expect(rejected(inspectRoomFile(textFile("notes.txt", "text/markdown", "hello")))).toEqual({ error: "That file type isn't supported. Use a .txt, .md, or .csv file." });
    expect(rejected(inspectRoomFile(textFile("run.exe", "application/octet-stream", "MZ")))).toEqual({ error: "That file type isn't supported. Use a .txt, .md, or .csv file." });
    expect(rejected(inspectRoomFile(textFile("photo.png", "image/png", "png"))).error).toMatch(/isn't supported/);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(rejected(inspectRoomFile({ filename: "notes.txt", mimeType: "text/plain", bytes: png })).error).toBe("That file isn't supported text.");
    const pdf = new TextEncoder().encode("%PDF-1.7 not actually extracted");
    expect(rejected(inspectRoomFile({ filename: "notes.txt", mimeType: "text/plain", bytes: pdf })).error).toBe("That file isn't supported text.");
    expect(rejected(inspectRoomFile({ filename: "page.pdf", mimeType: "application/pdf", bytes: pdf })).error).toMatch(/isn't supported/);
  });

  it("rejects an over-limit file and truncates extracted text", () => {
    const oversized = new Uint8Array(MAX_FILE_BYTES + 1);
    oversized.fill(97);
    expect(inspectRoomFile({ filename: "big.txt", mimeType: "text/plain", bytes: oversized })).toEqual({ error: "That file is larger than 5 MB." });
    const long = "a".repeat(MAX_EXTRACTED_CHARS + 25);
    const inspected = inspectRoomFile(textFile("long.txt", "text/plain", long));
    expect(inspected).toMatchObject({ truncated: true });
    if ("text" in inspected) expect([...inspected.text].length).toBeLessThanOrEqual(MAX_EXTRACTED_CHARS);
  });

  it("keeps a display-safe basename and never uses the client path as the storage key", () => {
    expect(displayFileName("C:\\users\\other\\..\\notes.txt")).toEqual({ name: "notes.txt" });
    expect(displayFileName("../../secrets.txt")).toEqual({ name: "secrets.txt" });
    expect(displayFileName("bad\u0000name.txt")).toEqual({ name: "badname.txt" });
    expect(displayFileName("..txt")).toEqual({ error: "Choose a file with a clear name." });
    expect("error" in displayFileName(`${"n".repeat(121)}.txt`)).toBe(true);
    const stored = buildRoomFilePath(owner, room, file, "txt");
    expect(stored).toEqual({ path: `${owner}/${room}/${file}/${file}.txt` });
    expect(buildRoomFilePath(other, room, file, "txt").path).not.toContain("notes.txt");
    expect("error" in buildRoomFilePath("not-a-user", room, file, "txt")).toBe(true);
  });

  it("accepts only explicit file ids and ignores an absent selection", () => {
    expect(parseSelectedFileIds(undefined, MAX_FILES_PER_MESSAGE)).toEqual({ ok: true, ids: [] });
    expect(parseSelectedFileIds([file], MAX_FILES_PER_MESSAGE)).toEqual({ ok: true, ids: [file] });
    expect(parseSelectedFileIds({ user_id: other, fileIds: [file] }, MAX_FILES_PER_MESSAGE)).toEqual({ ok: false });
    expect(parseSelectedFileIds([file, file], MAX_FILES_PER_MESSAGE)).toEqual({ ok: false });
    expect(parseSelectedFileIds([file, room, owner, other], MAX_FILES_PER_MESSAGE)).toEqual({ ok: false });
  });
});

describe("room file deletion", () => {
  it("does not claim success when storage deletion fails, and does when both parts succeed", () => {
    expect(fileDeletionOutcome("failed", false)).toEqual({ complete: false, error: "The file is still saved because storage deletion failed." });
    expect(fileDeletionOutcome("removed", false).complete).toBe(false);
    expect(fileDeletionOutcome("missing", true)).toEqual({ complete: true, error: null });
    expect(fileDeletionOutcome("removed", true).complete).toBe(true);
  });
});

describe("room file ownership", () => {
  function client(options: { room?: boolean; storage?: "ok" | "fail"; count?: number }) {
    const upload = vi.fn(async () => ({ error: options.storage === "fail" ? { message: "upload failed" } : null }));
    const remove = vi.fn(async () => ({ error: options.storage === "fail" ? { message: "storage failed" } : null }));
    const inserts: Record<string, unknown>[] = [];
    const deletes: string[] = [];
    const db = {
      from(table: string) {
        const state = { table, op: "select" as "select" | "insert" | "delete", head: false };
        const builder = {
          select(_columns: string, query?: { head?: boolean }) { state.head = Boolean(query?.head); return builder; },
          eq() { return builder; },
          in() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          insert(row: Record<string, unknown>) { state.op = "insert"; inserts.push(row); return builder; },
          delete() { state.op = "delete"; deletes.push(table); return builder; },
          maybeSingle: async () => {
            if (state.table === "rooms") return { data: options.room === false ? null : { id: room }, error: null };
            if (state.op === "insert") {
              const row = inserts.at(-1);
              return { data: { id: row?.id, original_name: row?.original_name, mime_type: row?.mime_type, size_bytes: row?.size_bytes, created_at: "2026-10-03T00:00:00.000Z" }, error: null };
            }
            if (state.op === "delete") return { data: { id: file }, error: null };
            return { data: { id: file, storage_path: `${owner}/${room}/${file}/${file}.txt` }, error: null };
          },
          then(resolve: (value: { data: unknown; error: null; count?: number }) => unknown) {
            return Promise.resolve({ data: [], error: null, count: options.count ?? 0 }).then(resolve);
          },
        };
        return builder;
      },
      storage: { from: () => ({ upload, remove }) },
    } as unknown as RoomFileClient;
    return { db, upload, remove, inserts, deletes };
  }

  it("stores the file under the session owner and refuses another user's room", async () => {
    const owned = client({});
    const saved = await saveRoomFile(owned.db, owner, room, textFile(`../${other}.txt`, "text/plain", "hello"));
    expect(saved.data?.original_name).toBe(`${other}.txt`);
    expect(owned.inserts[0]).toMatchObject({ user_id: owner, room_id: room, storage_path: `${owner}/${room}/${owned.inserts[0]?.id}/${owned.inserts[0]?.id}.txt` });
    expect(String(owned.inserts[0]?.storage_path)).not.toContain("..");
    const foreign = client({ room: false });
    await expect(saveRoomFile(foreign.db, owner, room, textFile("notes.txt", "text/plain", "hello"))).resolves.toEqual({ error: "That room is no longer available." });
    expect(foreign.upload).not.toHaveBeenCalled();
  });

  it("leaves the database row in place when storage deletion fails", async () => {
    const failed = client({ storage: "fail" });
    await expect(deleteRoomFile(failed.db, owner, room, file)).resolves.toMatchObject({ complete: false });
    expect(failed.deletes).toHaveLength(0);
    const removed = client({});
    await expect(deleteRoomFile(removed.db, owner, room, file)).resolves.toEqual({ complete: true, error: null });
    expect(removed.remove).toHaveBeenCalledWith([`${owner}/${room}/${file}/${file}.txt`]);
    expect(removed.deletes).toEqual(["room_files"]);
  });
});

describe("file context", () => {
  it("keeps selected file text out of product policy and reports File context", () => {
    const plan = buildContext(input({
      room: { name: "Lab", instructions: "Stay calm", brief: null },
      files: [{ name: "notes.txt", text: "The launch code is blue." }],
    }));
    const ids = plan.blocks.map((block) => block.id);
    expect(ids.indexOf("room")).toBeLessThan(ids.indexOf("file"));
    expect(ids.indexOf("file")).toBeLessThan(ids.indexOf("thread_summary"));
    const fileBlock = plan.blocks.find((block) => block.id === "file");
    expect(fileBlock).toMatchObject({ authority: "untrusted_data", included: true });
    expect(plan.blocks.find((block) => block.id === "core")?.text).toBe(CONTEXT_POLICY_TEXT);
    expect(plan.blocks.find((block) => block.id === "core")?.text).not.toContain("launch code");
    expect(plan.diagnostics.sources.find((source) => source.type === "file")).toEqual({ type: "file", label: "File context", state: "included", reason: "Selected room file" });
    expect(JSON.stringify(plan.diagnostics)).not.toContain("launch code");
    const provider = toProviderMessages(plan);
    expect(provider[0]?.content).not.toContain("launch code");
    expect(provider[1]?.content).toContain("The launch code is blue.");
    expect(provider.at(-1)).toEqual({ role: "user", content: "hello" });
    expect(buildContext(input()).diagnostics.sources.map((source) => source.type)).toEqual(["profile", "recent_messages", "thread_summary"]);
  });

  it("drops file text that does not fit the file budget", () => {
    const plan = buildContext(input({
      files: [{ name: "notes.txt", text: "f".repeat(20_000) }],
      // The smallest window in the suite: it still fits the core policy and the request, but never all of this file.
      capabilities: { contextWindowTokens: 1_400, maxOutputTokens: 4 },
    }));
    const fileBlock = plan.blocks.find((block) => block.id === "file");
    expect(fileBlock?.text.length ?? 0).toBeLessThan(20_000);
    expect(plan.budget.truncated).toBe(true);
    expect(plan.blocks.find((block) => block.id === "current_request")?.text).toBe("hello");
  });
});
