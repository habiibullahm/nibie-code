import type { ConversationSummary, PersistedMessage, RoomSummary } from "@/lib/chat/read";

export type Conversation = ConversationSummary & { messages: PersistedMessage[] };
export type WorkspaceData = { conversations: ConversationSummary[]; archivedConversations?: ConversationSummary[]; temporaryConversation?: ConversationSummary | null; rooms?: RoomSummary[]; roomsError?: string | null; messages: PersistedMessage[]; activeId: string | null; error: string | null };
export type GenerateOptions = { regenerate?: boolean; replaceIds?: string[]; placeholderId?: string; fileIds?: string[] };
// While a response's outcome is unknown, the server is polled until it reports a settled state (see lib/chat/recovery.ts).
export type Recovery = { conversationId: string; assistantId: string | null; baseline: WorkspaceData | undefined };
export const failureNotice = "Nibie couldn't complete that response. Please try again.";
export const unconfirmedNotice = "We couldn't confirm that response. Reload the page to check it.";
export const stillFinishingNotice = "A response is still finishing. It will appear here when it's done.";
export const checkAgainNotice = "This response is still in progress. Refresh the page to check it again.";
export const droppedConnectionNotice = "The connection dropped. Checking whether your response was saved…";
