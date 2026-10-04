import { validateConversationId } from "@/lib/chat/validation";

export const chatPath = "/chat";
export const workbenchPath = "/workbench";

export function workbenchDocumentPath(id: string) {
  return `${workbenchPath}/${encodeURIComponent(id)}`;
}

export function conversationPath(id: string) {
  return `${chatPath}?conversation=${encodeURIComponent(id)}`;
}

export function roomPath(id: string) {
  return `${chatPath}?room=${encodeURIComponent(id)}`;
}

export function roomDraftPath(id: string) {
  return `${roomPath(id)}&draft=1`;
}

// Old bookmarks used /?conversation=<uuid>. Only a real conversation id leaves the marketing page.
export function legacyConversationPath(value: unknown) {
  const parsed = validateConversationId(value);
  return parsed.success ? conversationPath(parsed.data) : null;
}
