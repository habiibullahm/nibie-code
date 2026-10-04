import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, modelOptions } = vi.hoisted(() => ({ createClient: vi.fn(), modelOptions: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/ai/registry", () => ({ getModelOptions: modelOptions }));

import { POST } from "../../app/api/chat/attachments/route";
import { DELETE } from "../../app/api/chat/attachments/[attachmentId]/route";
import { addUserMessageAction, startConversationAction } from "../../app/actions/chat";
import { MAX_ATTACHMENT_BYTES } from "../../lib/attachments/limits";
import { attachmentErrors } from "../../lib/attachments/rules";

const owner = "7c1f8a52-4f61-4d7e-9a3e-1b2c3d4e5f60";
const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const message = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
const attachmentId = "a1b2c3d4-0000-4000-8000-000000000001";
const signedIn = { getClaims: async () => ({ data: { claims: { sub: owner } }, error: null }) };

// A chainable query that records its calls and resolves to the next queued result.
function table(results: unknown[], calls: unknown[][]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "lt", "insert", "delete", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
  }
  const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
  builder.maybeSingle = next;
  builder.single = next;
  builder.then = (resolve: (value: unknown) => unknown) => next().then(resolve);
  return builder;
}

function upload(file: File | null, extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.set("file", file);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return new Request("http://localhost/api/chat/attachments", { method: "POST", body: form, headers });
}

describe("POST /api/chat/attachments", () => {
  beforeEach(() => { createClient.mockReset(); });

  it("requires a session and a same-origin request", async () => {
    createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: null, error: new Error("none") }) }, from: vi.fn() });
    expect((await POST(upload(new File(["x"], "a.txt")))).status).toBe(401);
    const from = vi.fn();
    createClient.mockResolvedValue({ auth: signedIn, from });
    expect((await POST(upload(new File(["x"], "a.txt"), {}, { origin: "https://evil.example" }))).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("never lets a request name an owner, message or conversation", async () => {
    const from = vi.fn();
    createClient.mockResolvedValue({ auth: signedIn, from });
    for (const field of ["user_id", "message_id", "conversation_id", "extracted_text"]) {
      const response = await POST(upload(new File(["x"], "a.txt"), { [field]: "someone-else" }));
      expect(response.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects images, unsupported files and oversized uploads before saving", async () => {
    const from = vi.fn();
    createClient.mockResolvedValue({ auth: signedIn, from });
    const image = await POST(upload(new File([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], "photo.png", { type: "image/png" })));
    expect(image.status).toBe(400);
    expect(await image.json()).toEqual({ error: attachmentErrors.image });
    expect((await POST(upload(new File(["MZ"], "tool.exe")))).status).toBe(400);
    const declaredTooLarge = await POST(upload(new File(["x"], "a.txt"), {}, { "content-length": String(MAX_ATTACHMENT_BYTES * 2) }));
    expect(declaredTooLarge.status).toBe(413);
    expect((await POST(upload(new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1).fill(65)], "big.txt")))).status).toBe(413);
    expect(from).not.toHaveBeenCalled();
  });

  it("saves the extracted text as an unlinked draft of the session owner and returns metadata only", async () => {
    const calls: unknown[][] = [];
    const results = [
      { data: null, error: null },
      { data: null, error: null, count: 0 },
      { data: { id: attachmentId, original_name: "attachment-a.txt", mime_type: "text/plain", size_bytes: 64, truncated: false, page_count: null }, error: null },
    ];
    createClient.mockResolvedValue({ auth: signedIn, from: (name: string) => { calls.push(["from", name]); return table(results, calls); } });
    const response = await POST(upload(new File(["The internal codename for this test document is Cedar Harbor."], "attachment-a.txt", { type: "text/plain" })));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ attachment: { id: attachmentId, name: "attachment-a.txt", mimeType: "text/plain", sizeBytes: 64, truncated: false, pageCount: null } });
    expect(JSON.stringify(body)).not.toContain("Cedar Harbor");
    const insert = calls.find((call) => call[0] === "insert")![1] as Record<string, unknown>;
    expect(insert).toEqual({ user_id: owner, original_name: "attachment-a.txt", mime_type: "text/plain", size_bytes: new TextEncoder().encode("The internal codename for this test document is Cedar Harbor.").byteLength, extracted_text: "The internal codename for this test document is Cedar Harbor.", truncated: false, page_count: null });
    expect(insert).not.toHaveProperty("message_id");
    expect(calls.filter((call) => call[0] === "from").every((call) => call[1] === "message_attachments")).toBe(true);
  });

  it("explains a full draft list and a database that has no attachments yet", async () => {
    const fullQueue = [{ data: null, error: null }, { data: null, error: null, count: 20 }];
    createClient.mockResolvedValue({ auth: signedIn, from: () => table(fullQueue, []) });
    const full = await POST(upload(new File(["x"], "a.txt")));
    expect(full.status).toBe(409);
    const missingQueue = [{ data: null, error: null }, { data: null, error: { code: "PGRST205" } }];
    createClient.mockResolvedValue({ auth: signedIn, from: () => table(missingQueue, []) });
    const missing = await POST(upload(new File(["x"], "a.txt")));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "Attachments aren't available yet." });
  });
});

describe("DELETE /api/chat/attachments/[attachmentId]", () => {
  beforeEach(() => { createClient.mockReset(); });

  it("removes only the owner's unsent draft", async () => {
    const calls: unknown[][] = [];
    createClient.mockResolvedValue({ auth: signedIn, from: (name: string) => { calls.push(["from", name]); return table([{ data: { id: attachmentId }, error: null }], calls); } });
    const request = new Request(`http://localhost/api/chat/attachments/${attachmentId}`, { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ attachmentId }) });
    expect(response.status).toBe(200);
    expect(calls).toEqual([["from", "message_attachments"], ["delete"], ["eq", "id", attachmentId], ["is", "message_id", null], ["select", "id"]]);
    expect((await DELETE(request, { params: Promise.resolve({ attachmentId: "../x" }) })).status).toBe(400);
  });
});

describe("sending a message with attachments", () => {
  beforeEach(() => { createClient.mockReset(); modelOptions.mockReset().mockReturnValue({ models: [{ id: "Balanced" }] }); });

  it("saves the message and links its attachments in one call, and keeps plain messages on the existing call", async () => {
    const rpc = vi.fn(() => ({ single: async () => ({ data: { id: message, position: 3 }, error: null }) }));
    createClient.mockResolvedValue({ auth: signedIn, rpc, from: vi.fn() });
    await expect(addUserMessageAction(conversation, "What is the codename?", message, [], [attachmentId])).resolves.toEqual({ data: { id: message, position: 3 } });
    expect(rpc).toHaveBeenLastCalledWith("append_user_message_with_attachments", { p_conversation_id: conversation, p_message_id: message, p_content: "What is the codename?", p_attachment_ids: [attachmentId] });
    await addUserMessageAction(conversation, "Plain", message, []);
    expect(rpc).toHaveBeenLastCalledWith("append_user_message", { p_conversation_id: conversation, p_message_id: message, p_content: "Plain" });
  });

  it("refuses malformed or duplicate attachment ids before opening a client", async () => {
    await expect(addUserMessageAction(conversation, "x", message, [], [attachmentId, attachmentId])).resolves.toEqual({ error: attachmentErrors.tooMany });
    await expect(addUserMessageAction(conversation, "x", message, [], ["not-an-id"])).resolves.toEqual({ error: attachmentErrors.tooMany });
    await expect(startConversationAction("Balanced", message, "x", null, Array.from({ length: 4 }, () => crypto.randomUUID()))).resolves.toEqual({ error: attachmentErrors.tooMany });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reports an attachment that can no longer be claimed, and a new conversation is not left behind", async () => {
    const rpc = vi.fn(() => ({ single: async () => ({ data: null, error: { code: "PT409", message: "Attachment unavailable." } }) }));
    const removed: unknown[] = [];
    const conversations = {
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: conversation, title: "New chat", selected_model: "Balanced", room_id: null, created_at: "", updated_at: "" }, error: null }) }) }),
      delete: () => ({ eq: (column: string, value: string) => { removed.push([column, value]); return Promise.resolve({ error: null }); } }),
    };
    createClient.mockResolvedValue({ auth: signedIn, rpc, from: () => conversations });
    await expect(startConversationAction("Balanced", message, "What is the codename?", null, [attachmentId])).resolves.toEqual({ error: attachmentErrors.unavailable });
    expect(removed).toEqual([["id", conversation]]);
    rpc.mockImplementation(() => ({ single: async () => ({ data: null, error: { code: "PT413", message: "too large" } }) }));
    await expect(addUserMessageAction(conversation, "x", message, [], [attachmentId])).resolves.toEqual({ error: attachmentErrors.totalTooLarge });
  });
});
