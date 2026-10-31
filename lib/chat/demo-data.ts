import type { ConversationSummary, PersistedMessage } from "./read";
import type { CitationSourceView } from "@/lib/citations/types";
import type { ContextDiagnostics, ContextSourceDiagnostic } from "@/lib/context/context-types";

export const demoChatId = "demo-chat-note";
export const demoResearchId = "demo-research-files";

export const demoChatReply = "Lead with the decision, then the reason. One sentence on what changed is enough.";
export const demoResearchReply = "From saved Memory: Room files stay at 5 MB per file.\n\nThe current Next.js App Router docs describe Server Components as the default for routes in the app directory [1]. Data loading can stay on the server so the browser does not need a separate client fetch for that first paint.";
export const demoCannedReply = "This is a recorded demo reply. Create an account to use live Nibie on your own work.";

const demoStamp = "2026-10-01T08:30:00.000Z";
const dayMs = 86_400_000;

const demoResearchSources: CitationSourceView[] = [
  {
    ordinal: 1,
    kind: "web",
    title: "Getting Started: App Router",
    url: "https://nextjs.org/docs/app/getting-started",
    domain: "nextjs.org",
  },
];

export type DemoConversation = ConversationSummary & { messages: PersistedMessage[] };

export function createDemoConversations(renderedAt: number): DemoConversation[] {
  const stamp = (daysAgo: number) => new Date(renderedAt - daysAgo * dayMs).toISOString();
  return [
    {
      id: demoChatId,
      title: "Tighten the team note",
      selected_model: "Balanced",
      room_id: null,
      created_at: stamp(0),
      updated_at: stamp(0),
      messages: [
        { id: "demo-chat-user", role: "user", content: "Help me tighten this before I send it to the team.", position: 1, status: "complete", created_at: demoStamp },
        { id: "demo-chat-assistant", role: "assistant", content: demoChatReply, position: 2, status: "complete", created_at: demoStamp },
      ],
    },
    {
      id: demoResearchId,
      title: "Room file size and App Router",
      selected_model: "Balanced",
      room_id: null,
      created_at: stamp(1),
      updated_at: stamp(1),
      messages: [
        {
          id: "demo-research-user",
          role: "user",
          content: "What did we decide about Room file size, and what do the current Next.js App Router docs say about Server Components?",
          position: 1,
          status: "complete",
          created_at: demoStamp,
        },
        {
          id: "demo-research-assistant",
          role: "assistant",
          content: demoResearchReply,
          position: 2,
          status: "complete",
          created_at: demoStamp,
          actionLabel: "Used Web Search",
          sources: demoResearchSources,
        },
      ],
    },
  ];
}

export type CannedDemoReply = {
  content: string;
  sources?: CitationSourceView[];
  actionLabel?: string;
};

export function cannedDemoReply(content: string): CannedDemoReply {
  const text = content.toLowerCase();
  if (/\b(file size|app router|server components|research|memory)\b/.test(text)) {
    return { content: demoResearchReply, sources: demoResearchSources, actionLabel: "Used Web Search" };
  }
  if (/\b(tighten|team note|note to the team)\b/.test(text)) {
    return { content: demoChatReply };
  }
  return { content: demoCannedReply };
}

const demoMemorySource: ContextSourceDiagnostic = {
  type: "memory",
  label: "Saved memories",
  state: "included",
  reason: "Room files stay at 5 MB per file.",
};

export function withDemoMemoryContext(diagnostics: ContextDiagnostics, conversationId: string | null): ContextDiagnostics {
  if (conversationId !== demoResearchId) return diagnostics;
  if (diagnostics.sources.some((source) => source.type === "memory")) return diagnostics;
  return { ...diagnostics, sources: [demoMemorySource, ...diagnostics.sources] };
}
