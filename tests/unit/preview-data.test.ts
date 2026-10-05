import { describe, expect, it } from "vitest";
import { createPreviewConversations } from "@/lib/chat/preview-data";

describe("preview conversations", () => {
  it("derives history timestamps from the shared render instant", () => {
    const renderedAt = Date.parse("2026-10-04T18:51:29.662Z");
    const first = createPreviewConversations(renderedAt);
    const second = createPreviewConversations(renderedAt);

    expect(first.map(({ id, created_at, updated_at }) => ({ id, created_at, updated_at }))).toEqual([
      { id: "preview-writing", created_at: "2026-10-04T18:51:29.662Z", updated_at: "2026-10-04T18:51:29.662Z" },
      { id: "preview-learning", created_at: "2026-10-03T18:51:29.662Z", updated_at: "2026-10-03T18:51:29.662Z" },
      { id: "preview-code", created_at: "2026-10-02T18:51:29.662Z", updated_at: "2026-10-02T18:51:29.662Z" },
    ]);
    expect(second).toEqual(first);
  });
});
