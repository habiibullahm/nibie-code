import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cannedDemoReply,
  createDemoConversations,
  demoCannedReply,
  demoChatId,
  demoChatReply,
  demoResearchId,
  demoResearchReply,
  withDemoMemoryContext,
} from "@/lib/chat/demo-data";
import type { ContextDiagnostics } from "@/lib/context/context-types";

describe("demo conversations", () => {
  it("seeds a chat reply and a cited research reply from the same render instant", () => {
    const renderedAt = Date.parse("2026-10-04T18:51:29.662Z");
    const first = createDemoConversations(renderedAt);
    const second = createDemoConversations(renderedAt);

    expect(first.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: demoChatId, title: "Tighten the team note" },
      { id: demoResearchId, title: "Room file size and App Router" },
    ]);
    expect(first[0].messages.at(-1)?.content).toBe(demoChatReply);
    expect(first[1].messages.at(-1)?.content).toBe(demoResearchReply);
    expect(first[1].messages.at(-1)?.sources).toEqual([
      {
        ordinal: 1,
        kind: "web",
        title: "Getting Started: App Router",
        url: "https://nextjs.org/docs/app/getting-started",
        domain: "nextjs.org",
      },
    ]);
    expect(second).toEqual(first);
  });

  it("returns recorded replies without calling a model", () => {
    expect(cannedDemoReply("Help me tighten this before I send it to the team.")).toEqual({ content: demoChatReply });
    expect(cannedDemoReply("Remind me about Room file size and App Router.").content).toBe(demoResearchReply);
    expect(cannedDemoReply("What is Nibie?").content).toBe(demoCannedReply);
  });

  it("adds Memory to the research thread context only", () => {
    const base: ContextDiagnostics = { sources: [], recentMessageCount: 1 };
    expect(withDemoMemoryContext(base, demoChatId)).toEqual(base);
    const research = withDemoMemoryContext(base, demoResearchId);
    expect(research.sources[0]).toMatchObject({ type: "memory", state: "included" });
  });
});

describe("demo isolation", () => {
  it("keeps the public demo page free of auth, database, and provider imports", () => {
    const source = readFileSync(new URL("../../app/demo/page.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/requireAuthenticatedUser|getChatWorkspaceData|createSupabase|@\/lib\/ai|@\/lib\/supabase|startConversationAction|addUserMessageAction/);
  });
});
