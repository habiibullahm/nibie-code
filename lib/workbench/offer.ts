const placeholderResponses = new Set(["Response stopped.", "Response unavailable."]);

export type WorkbenchOfferMessage = {
  role: string;
  status?: string;
  content: string;
};

// Only a finished assistant response can become a document. Streaming, stopped, and error rows stay in chat.
export function canContinueInWorkbench(message: WorkbenchOfferMessage): boolean {
  return message.role === "assistant"
    && message.status === "complete"
    && message.content.trim().length > 0
    && !placeholderResponses.has(message.content);
}
