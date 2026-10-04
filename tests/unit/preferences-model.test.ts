import { describe, expect, it } from "vitest";
import { resolveMode } from "../../lib/chat/models";
import { modelForComposer, resolveDefaultModel } from "../../lib/preferences/model";

const all = ["Fast", "Balanced", "High"] as const;

describe("default model fallback", () => {
  it("uses the account default only when starting a conversation", () => {
    expect(modelForComposer({ hasConversation: false, accountDefault: "reasoning", available: all })).toBe("High");
    expect(modelForComposer({ hasConversation: true, conversationModel: "Fast", accountDefault: "reasoning", available: all })).toBe("Fast");
    expect(resolveMode("Fast", all)).toBe("Fast");
  });

  it("falls back when the stored default is missing or no longer configured", () => {
    expect(resolveDefaultModel("reasoning", ["Fast", "Balanced"])).toBe("Balanced");
    expect(resolveDefaultModel("balanced", ["Fast"])).toBe("Fast");
    expect(resolveDefaultModel("nope", ["High"])).toBe("High");
    expect(resolveDefaultModel(undefined, ["Fast", "High"])).toBe("Fast");
    expect(resolveDefaultModel("balanced", [])).toBeNull();
  });

  it("keeps an existing conversation on its saved mode", () => {
    expect(modelForComposer({ hasConversation: true, conversationModel: "Fast", accountDefault: "reasoning", available: ["Fast", "Balanced"] })).toBe("Fast");
  });
});
