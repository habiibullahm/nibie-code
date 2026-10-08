import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, modelOptions } = vi.hoisted(() => ({ createClient: vi.fn(), modelOptions: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
vi.mock("@/lib/ai/registry", () => ({ getModelOptions: modelOptions }));

import { POST as createSession } from "../../app/api/chat/attachments/route";
import { POST as confirmUpload } from "../../app/api/chat/attachments/confirm/route";
import { DELETE } from "../../app/api/chat/attachments/[attachmentId]/route";
import { addUserMessageAction, startConversationAction } from "../../app/actions/chat";
import { MAX_ATTACHMENT_BYTES } from "../../lib/attachments/limits";
import { attachmentErrors } from "../../lib/attachments/rules";

const owner = "7c1f8a52-4f61-4d7e-9a3e-1b2c3d4e5f60";
const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const message = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
const attachmentId = "a1b2c3d4-0000-4000-8000-000000000001";
const uploadId = "c0ffee00-0000-4000-8000-000000000099";
const signedIn = { getClaims: async () => ({ data: { claims: { sub: owner } }, error: null }) };
const stagingPath = `${owner}/drafts/${uploadId}/${uploadId}.txt`;

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

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function sessionClient(options: {
  fromResults?: Record<string, unknown[]>;
  signed?: { data: { signedUrl: string; token: string; path: string } | null; error: unknown };
  download?: { data: Blob | null; error: unknown };
  removeError?: unknown;
  calls?: unknown[][];
} = {}) {
  const calls = options.calls ?? [];
  const queues = options.fromResults ?? {};
  const storage = {
    createSignedUploadUrl: vi.fn(async () => options.signed ?? { data: { signedUrl: "https://storage.example/sign", token: "tok", path: stagingPath }, error: null }),
    download: vi.fn(async () => options.download ?? { data: new Blob(["hello"]), error: null }),
    remove: vi.fn(async () => ({ data: null, error: options.removeError ?? null })),
  };
  return {
    auth: signedIn,
    from: (name: string) => {
      calls.push(["from", name]);
      return table(queues[name] ?? [], calls);
    },
    storage: { from: () => storage },
    _storage: storage,
    _calls: calls,
  };
}

describe("POST /api/chat/attachments (upload session)", () => {
  beforeEach(() => { createClient.mockReset(); });

  it("requires a session and a same-origin request", async () => {
    createClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: null, error: new Error("none") }) }, from: vi.fn(), storage: { from: vi.fn() } });
    expect((await createSession(jsonRequest("http://localhost/api/chat/attachments", { name: "a.txt", size: 1, type: "text/plain" }))).status).toBe(401);
    const from = vi.fn();
    createClient.mockResolvedValue({ auth: signedIn, from, storage: { from: vi.fn() } });
    expect((await createSession(jsonRequest("http://localhost/api/chat/attachments", { name: "a.txt", size: 1, type: "text/plain" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("never lets a request name an owner, message or conversation", async () => {
    const from = vi.fn();
    createClient.mockResolvedValue({ auth: signedIn, from, storage: { from: vi.fn() } });
    for (const field of ["user_id", "message_id", "conversation_id", "extracted_text"]) {
      const response = await createSession(jsonRequest("http://localhost/api/chat/attachments", { name: "a.txt", size: 1, type: "text/plain", [field]: "someone-else" }));
      expect(response.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects images, unsupported files and oversized uploads before signing", async () => {
    const client = sessionClient();
    createClient.mockResolvedValue(client);
    const image = await createSession(jsonRequest("http://localhost/api/chat/attachments", { name: "photo.png", size: 10, type: "image/png" }));
    expect(image.status).toBe(400);
    expect(await image.json()).toEqual({ error: attachmentErrors.image });
    expect((await createSession(jsonRequest("http://localhost/api/chat/attachments", { name: "tool.exe", size: 10, type: "" }))).status).toBe(400);
    const tooLarge = await createSession(jsonRequest("http://localhost/api/chat/attachments", { name: "a.txt", size: MAX_ATTACHMENT_BYTES + 1, type: "text/plain" }));
    expect(tooLarge.status).toBe(413);
    expect(client._storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns a signed upload ticket without buffering file bytes", async () => {
    const calls: unknown[][] = [];
    const resultsByTable: Record<string, unknown[]> = {
      attachment_upload_sessions: [
        { data: [], error: null },
        { data: { id: uploadId }, error: null },
      ],
      message_attachments: [
        { data: null, error: null },
        { data: null, error: null, count: 0 },
      ],
    };
    const storage = {
      createSignedUploadUrl: vi.fn(async () => ({ data: { signedUrl: "https://storage.example/sign?token=tok", token: "tok", path: stagingPath }, error: null })),
      download: vi.fn(),
      remove: vi.fn(async () => ({ data: null, error: null })),
    };
    createClient.mockResolvedValue({
      auth: signedIn,
      from: (name: string) => { calls.push(["from", name]); return table(resultsByTable[name] ?? [], calls); },
      storage: { from: () => storage },
    });

    const response = await createSession(jsonRequest("http://localhost/api/chat/attachments", { name: "notes.txt", size: 12, type: "text/plain" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.upload).toMatchObject({
      signedUrl: "https://storage.example/sign?token=tok",
      token: "tok",
      contentType: "text/plain",
    });
    expect(body.upload.uploadId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toContain("extracted");
  });
});

describe("POST /api/chat/attachments/confirm", () => {
  beforeEach(() => { createClient.mockReset(); });

  it("downloads staging bytes, saves extracted text, and removes the object", async () => {
    const text = "The internal codename for this test document is Cedar Harbor.";
    const calls: unknown[][] = [];
    const resultsByTable: Record<string, unknown[]> = {
      attachment_upload_sessions: [
        {
          data: {
            id: uploadId,
            user_id: owner,
            storage_path: stagingPath,
            original_name: "attachment-a.txt",
            mime_type: "text/plain",
            declared_size: new TextEncoder().encode(text).byteLength,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          error: null,
        },
        { data: null, error: null },
      ],
      message_attachments: [
        { data: null, error: null },
        { data: null, error: null, count: 0 },
        { data: { id: attachmentId, original_name: "attachment-a.txt", mime_type: "text/plain", size_bytes: new TextEncoder().encode(text).byteLength, truncated: false, page_count: null }, error: null },
      ],
    };
    const storage = {
      createSignedUploadUrl: vi.fn(),
      download: vi.fn(async () => ({ data: new Blob([text]), error: null })),
      remove: vi.fn(async () => ({ data: null, error: null })),
    };
    createClient.mockResolvedValue({
      auth: signedIn,
      from: (name: string) => { calls.push(["from", name]); return table(resultsByTable[name] ?? [], calls); },
      storage: { from: () => storage },
    });

    const response = await confirmUpload(jsonRequest("http://localhost/api/chat/attachments/confirm", { uploadId }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ attachment: { id: attachmentId, name: "attachment-a.txt", mimeType: "text/plain", sizeBytes: new TextEncoder().encode(text).byteLength, truncated: false, pageCount: null } });
    expect(JSON.stringify(body)).not.toContain("Cedar Harbor");
    expect(storage.download).toHaveBeenCalledWith(stagingPath);
    expect(storage.remove).toHaveBeenCalledWith([stagingPath]);
    const insert = calls.find((call) => call[0] === "insert" && typeof call[1] === "object" && call[1] && "extracted_text" in (call[1] as object))![1] as Record<string, unknown>;
    expect(insert.extracted_text).toBe(text);
    expect(insert).not.toHaveProperty("message_id");
  });

  it("aborts a staging upload without creating a draft", async () => {
    const calls: unknown[][] = [];
    const resultsByTable: Record<string, unknown[]> = {
      attachment_upload_sessions: [
        { data: { id: uploadId, user_id: owner, storage_path: stagingPath }, error: null },
        { data: null, error: null },
      ],
    };
    const storage = {
      createSignedUploadUrl: vi.fn(),
      download: vi.fn(),
      remove: vi.fn(async () => ({ data: null, error: null })),
    };
    createClient.mockResolvedValue({
      auth: signedIn,
      from: (name: string) => { calls.push(["from", name]); return table(resultsByTable[name] ?? [], calls); },
      storage: { from: () => storage },
    });
    const response = await confirmUpload(jsonRequest("http://localhost/api/chat/attachments/confirm", { uploadId, abort: true }));
    expect(response.status).toBe(200);
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith([stagingPath]);
    expect(calls.some((call) => call[0] === "insert")).toBe(false);
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
