import { describe, expect, it } from "vitest";
import { modelSchema, validateConversationId, validateMessage, validateTitle } from "../../lib/chat/validation";

describe("chat input validation", () => {
  it("accepts only the supported persisted response modes", () => {
    expect(modelSchema.safeParse("Fast").success).toBe(true);
    expect(modelSchema.safeParse("Balanced").success).toBe(true);
    expect(modelSchema.safeParse("High").success).toBe(true);
    expect(modelSchema.safeParse("default").success).toBe(false);
  });

  it("requires UUID conversation ids and bounded nonblank message content", () => {
    expect(validateConversationId("not-an-id").success).toBe(false);
    expect(validateConversationId("5e9bdcca-9205-4fea-a773-13952bb78c44").success).toBe(true);
    expect(validateMessage("   ").success).toBe(false);
    expect(validateMessage("  hello  ").data).toBe("hello");
    expect(validateMessage("x".repeat(20_001)).success).toBe(false);
  });

  it("trims and bounds conversation titles", () => {
    expect(validateTitle("  A title ").data).toBe("A title");
    expect(validateTitle(" ").success).toBe(false);
    expect(validateTitle("x".repeat(121)).success).toBe(false);
  });
});
