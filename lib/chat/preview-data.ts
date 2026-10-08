import { defaultChatRole } from "@/lib/chat-roles/types";
import type { ConversationSummary, PersistedMessage } from "./read";

type PreviewConversation = ConversationSummary & { messages: PersistedMessage[] };
const previewStamp = "2026-10-01T08:30:00.000Z";
const dayMs = 86_400_000;

export function createPreviewConversations(renderedAt: number): PreviewConversation[] {
  const stamp = (daysAgo: number) => new Date(renderedAt - daysAgo * dayMs).toISOString();
  return [
    { id: "preview-writing", title: "A thoughtful note to the team", selected_model: "Balanced", room_id: null, chat_role: defaultChatRole, custom_instructions: null, created_at: stamp(0), updated_at: stamp(0), messages: [{ id: "p1", role: "user", content: "Help me write a thoughtful note to my team after a busy launch week.", position: 1, created_at: previewStamp }, { id: "p2", role: "assistant", content: "A good note can recognize the effort, name what the team accomplished, and leave room for everyone to recharge.\n\nYou might start with what you noticed most: the care people brought to the final details, the way they supported one another, or a moment that made you proud.", position: 2, created_at: previewStamp }] },
    { id: "preview-learning", title: "Learning the basics of astronomy", selected_model: "Balanced", room_id: "preview-room-nibie", chat_role: defaultChatRole, custom_instructions: null, created_at: stamp(1), updated_at: stamp(1), messages: [{ id: "p3", role: "user", content: "Where should I begin if I want to learn astronomy?", position: 1, created_at: previewStamp }, { id: "p4", role: "assistant", content: "Start by looking up. Learning a few bright constellations and the phases of the Moon gives you a useful map. From there, the scale of the solar system becomes much easier to picture.", position: 2, created_at: previewStamp }] },
    { id: "preview-code", title: "Debouncing a search box", selected_model: "Balanced", room_id: null, chat_role: defaultChatRole, custom_instructions: null, created_at: stamp(2), updated_at: stamp(2), messages: [{ id: "p5", role: "user", content: "Show me a tiny debounce helper in TypeScript.", position: 1, created_at: previewStamp }, { id: "p6", role: "assistant", content: "A debounce helper delays a call until input has settled.\n\n## Example\n\n```ts\nexport function debounce<T extends unknown[]>(fn: (...args: T) => void, wait = 250) {\n  let timer: ReturnType<typeof setTimeout> | undefined;\n  return (...args: T) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), wait);\n  };\n}\n```\n\n- Use `wait` to tune responsiveness.\n- Read more in the [MDN guide](https://developer.mozilla.org/docs/Glossary/Debounce).", position: 2, created_at: previewStamp }] },
  ];
}
