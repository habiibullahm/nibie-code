let current: AbortController | null = null;
let conversationId: string | null = null;

export function liveChatConversationId() {
  return current && !current.signal.aborted ? conversationId : null;
}

export function startLiveChatStream(id: string) {
  current?.abort();
  current = new AbortController();
  conversationId = id;
  return current;
}

export function finishLiveChatStream(controller: AbortController) {
  if (current !== controller) return;
  current = null;
  conversationId = null;
}

export function abortLiveChatStream() {
  current?.abort();
  current = null;
  conversationId = null;
}

// Room and thread URLs are all /chat. Leaving that page is a real stop.
// Moving between a room and its thread remounts this page and must not.
export function shouldStopLiveChatOnLeave(pathname: string) {
  return pathname !== "/chat";
}
