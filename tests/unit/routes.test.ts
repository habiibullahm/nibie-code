import { describe, expect, it } from "vitest";
import { chatPath, conversationPath, legacyConversationPath, workbenchDocumentPath, workbenchPath } from "../../lib/routes";

const id = "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60";

describe("chat routes", () => {
  it("keeps the workspace at /chat", () => {
    expect(chatPath).toBe("/chat");
  });

  it("opens a conversation on /chat without changing the id", () => {
    expect(conversationPath(id)).toBe(`/chat?conversation=${id}`);
    expect(conversationPath("a b")).toBe("/chat?conversation=a%20b");
  });

  it("moves only a real saved conversation id off the marketing page", () => {
    expect(legacyConversationPath(id)).toBe(`/chat?conversation=${id}`);
    expect(legacyConversationPath(undefined)).toBeNull();
    expect(legacyConversationPath("")).toBeNull();
    expect(legacyConversationPath("not-a-conversation")).toBeNull();
  });
});

describe("workbench routes", () => {
  it("keeps documents on /workbench", () => {
    expect(workbenchPath).toBe("/workbench");
    expect(workbenchDocumentPath(id)).toBe(`/workbench/${id}`);
  });
});
