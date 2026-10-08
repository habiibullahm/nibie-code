import { describe, expect, it } from "vitest";
import {
  EXPORT_PAGE_SIZE,
  buildConversationExport,
  readAllPages,
  type ExportAttachmentRow,
  type ExportConversationRow,
  type ExportMessageRow,
} from "../../lib/privacy/export";

const exportedAt = "2026-10-02T00:00:00.000Z";

function conversation(overrides: Partial<ExportConversationRow> = {}): ExportConversationRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "First",
    selected_model: "Balanced",
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-03T00:00:00.000Z",
    ...overrides,
  };
}

function message(overrides: Partial<ExportMessageRow> = {}): ExportMessageRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    conversation_id: "11111111-1111-4111-8111-111111111111",
    role: "user",
    content: "hello",
    status: "complete",
    position: 1,
    created_at: "2026-01-02T00:00:01.000Z",
    reply_to_message_id: null,
    ...overrides,
  };
}

function attachment(overrides: Partial<ExportAttachmentRow> = {}): ExportAttachmentRow {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    message_id: "22222222-2222-4222-8222-222222222222",
    original_name: "notes.txt",
    extracted_text: "attachment body",
    ...overrides,
  };
}

describe("conversation export", () => {
  it("builds a versioned empty export", () => {
    expect(buildConversationExport({ conversations: [], messages: [], attachments: [], exportedAt })).toEqual({
      product: "Nibie",
      exportVersion: 2,
      exportedAt,
      conversations: [],
    });
  });

  it("includes conversations, messages, attachment names and text, timestamps, and the selected model, and nothing else", () => {
    const payload = buildConversationExport({
      conversations: [{ ...conversation(), user_id: "owner-secret", api_key: "sk-live" } as ExportConversationRow],
      messages: [{ ...message(), user_id: "owner-secret", provider: "secret-provider" } as ExportMessageRow],
      attachments: [{ ...attachment(), user_id: "owner-secret", storage_path: "secret/path" } as ExportAttachmentRow],
      exportedAt,
    });
    expect(payload).toEqual({
      product: "Nibie",
      exportVersion: 2,
      exportedAt,
      conversations: [{
        id: conversation().id,
        title: "First",
        selectedModel: "Balanced",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        messages: [{
          id: message().id,
          role: "user",
          content: "hello",
          status: "complete",
          position: 1,
          createdAt: "2026-01-02T00:00:01.000Z",
          replyToMessageId: null,
          attachments: [{ originalName: "notes.txt", extractedText: "attachment body" }],
        }],
      }],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("owner-secret");
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("secret-provider");
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("storage_path");
    expect(Object.keys(payload!.conversations[0])).toEqual(["id", "title", "selectedModel", "createdAt", "updatedAt", "messages"]);
    expect(Object.keys(payload!.conversations[0].messages[0])).toEqual([
      "id",
      "role",
      "content",
      "status",
      "position",
      "createdAt",
      "replyToMessageId",
      "attachments",
    ]);
  });

  it("omits unlinked draft attachments and fails closed on a linked orphan", () => {
    const withDraft = buildConversationExport({
      conversations: [conversation()],
      messages: [message()],
      attachments: [attachment({ message_id: null, original_name: "draft.txt", extracted_text: "draft body" })],
      exportedAt,
    });
    expect(withDraft?.conversations[0]?.messages[0]?.attachments).toEqual([]);

    expect(buildConversationExport({
      conversations: [conversation()],
      messages: [message()],
      attachments: [attachment({ message_id: "99999999-9999-4999-8999-999999999999" })],
      exportedAt,
    })).toBeNull();
  });

  it("strips internal reasoning from assistant messages and leaves user text unchanged", () => {
    const payload = buildConversationExport({
      conversations: [conversation()],
      messages: [
        message(),
        message({
          id: "44444444-4444-4444-8444-444444444444",
          role: "user",
          content: "I think <think>this note</think> should stay.",
          position: 2,
        }),
        message({
          id: "55555555-5555-4555-8555-555555555555",
          role: "assistant",
          content: "<think>private reasoning</think>\n# Proposal",
          position: 3,
        }),
      ],
      exportedAt,
    });
    const contents = payload?.conversations[0]?.messages.map((item) => item.content);
    expect(contents).toEqual([
      "hello",
      "I think <think>this note</think> should stay.",
      "# Proposal",
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const later = conversation({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Second",
      selected_model: "Reasoning",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    const sameTime = conversation({
      id: "00000000-0000-4000-8000-000000000000",
      title: "Earlier id",
      created_at: "2026-01-02T00:00:00.000Z",
    });
    const reply = message({
      id: "44444444-4444-4444-8444-444444444444",
      conversation_id: later.id,
      role: "assistant",
      content: "answer",
      position: 2,
      created_at: new Date("2026-02-01T00:00:02.000Z"),
      reply_to_message_id: "55555555-5555-4555-8555-555555555555",
    });
    const prompt = message({
      id: "55555555-5555-4555-8555-555555555555",
      conversation_id: later.id,
      content: "question",
      position: 1,
      created_at: "2026-02-01T00:00:01.000Z",
    });
    const firstFile = attachment({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      message_id: prompt.id,
      original_name: "a.txt",
      extracted_text: "a",
    });
    const secondFile = attachment({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      message_id: prompt.id,
      original_name: "b.txt",
      extracted_text: "b",
    });
    const forward = buildConversationExport({
      conversations: [conversation(), later, sameTime],
      messages: [message(), reply, prompt],
      attachments: [secondFile, firstFile],
      exportedAt,
    });
    const reversed = buildConversationExport({
      conversations: [sameTime, later, conversation()],
      messages: [prompt, message(), reply],
      attachments: [firstFile, secondFile],
      exportedAt,
    });
    expect(reversed).toEqual(forward);
    expect(forward?.conversations.map((item) => item.id)).toEqual([sameTime.id, conversation().id, later.id]);
    expect(forward?.conversations[2].messages.map((item) => item.position)).toEqual([1, 2]);
    expect(forward?.conversations[2].selectedModel).toBe("Reasoning");
    expect(forward?.conversations[2].messages[0].attachments.map((item) => item.originalName)).toEqual(["a.txt", "b.txt"]);
  });

  it("fails closed when a message has no conversation in the same snapshot", () => {
    expect(buildConversationExport({
      conversations: [],
      messages: [message({ content: "orphaned private note" })],
      exportedAt,
    })).toBeNull();
  });

  it("reads every page and fails closed on a partial or stuck read", async () => {
    const pages = [[{ id: "a" }, { id: "b" }], [{ id: "c" }]];
    const rows = await readAllPages(async (from) => ({ data: pages[from / 2] ?? [], error: null }), 2);
    expect(rows).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);

    await expect(readAllPages(async () => ({ data: null, error: { message: "db down" } }))).resolves.toBeNull();
    await expect(readAllPages(async () => { throw new Error("network"); })).resolves.toBeNull();
    const stuck = await readAllPages(async () => ({ data: Array.from({ length: EXPORT_PAGE_SIZE }, () => ({ id: "same" })), error: null }));
    expect(stuck).toBeNull();
    let nextId = 0;
    await expect(readAllPages(async () => ({ data: [{ id: String(nextId++) }], error: null }), 1)).resolves.toBeNull();
  });
});
