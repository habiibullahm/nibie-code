"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { useRouter } from "next/navigation";
import { useStableCallback } from "@/components/use-stable-callback";
import { forgetLastConversationId, readChatFlag, readLastConversationId } from "@/components/use-chat-preferences";
import type { WorkspaceData } from "@/components/chat-workspace-types";
import { decideRestoredConversation } from "@/lib/chat/preferences";
import { chatPath, conversationPath, roomDraftPath, roomPath } from "@/lib/routes";

type NavigationInput = {
  preview: boolean;
  conversationParam: string | null;
  roomParam: string | null;
  draftParam: boolean;
  router: ReturnType<typeof useRouter>;
  pinLatestRef: RefObject<boolean>;
  getLatestData: () => WorkspaceData | undefined;
  beforeConversation: (id: string | null, options?: { focusMessageId?: string }) => boolean;
  beforeRoom: (draft: boolean) => boolean;
  beforeNewChat: () => boolean;
  beforeDraftRoom: () => boolean;
  focusComposer: () => void;
};

export function useConversationNavigation({ preview, conversationParam, roomParam, draftParam, router, pinLatestRef, getLatestData, beforeConversation, beforeRoom, beforeNewChat, beforeDraftRoom, focusComposer }: NavigationInput) {
  const [previewActiveId, setPreviewActiveId] = useState<string | null>(null);
  // The conversation the user just chose, applied immediately while the server renders it. undefined = follow the URL.
  const [pendingId, setPendingId] = useState<string | null | undefined>(undefined);
  const [pendingRoomId, setPendingRoomId] = useState<string | null | undefined>(undefined);
  const [pendingDraft, setPendingDraft] = useState<boolean | undefined>(undefined);
  const restoredRef = useRef(false);
  // The navigation the user asked for has landed once the URL matches it; from then on the URL is the source of truth again.
  if (pendingId !== undefined && conversationParam === pendingId) setPendingId(undefined);
  if (pendingRoomId !== undefined && (roomParam ?? null) === pendingRoomId) setPendingRoomId(undefined);
  if (pendingDraft !== undefined && draftParam === pendingDraft) setPendingDraft(undefined);

  const restoreConversation = useStableCallback(() => {
    if (preview || restoredRef.current) return;
    restoredRef.current = true;
    const history = getLatestData()?.conversations ?? [];
    const decision = decideRestoredConversation({
      enabled: readChatFlag("restoreLastChat"),
      storedId: readLastConversationId(),
      accessibleIds: history.map((item) => item.id),
      requestedId: new URLSearchParams(window.location.search).get("conversation"),
      historyAvailable: !(getLatestData()?.error && history.length === 0),
    });
    if (decision.forgetStoredId) forgetLastConversationId();
    if (!decision.conversationId) return;
    const item = history.find((conversation) => conversation.id === decision.conversationId);
    if (!item) return;
    pinLatestRef.current = true;
    setPendingId(item.id);
    router.replace(conversationPath(item.id), { scroll: false });
  });
  useEffect(() => { restoreConversation(); }, [restoreConversation]);
  const openConversation = useStableCallback((id: string | null, options?: { focusMessageId?: string }) => {
    if (!beforeConversation(id, options)) return;
    setPendingRoomId(null); setPendingDraft(false);
    if (preview) setPreviewActiveId(id);
    else { setPendingId(id); router.push(id ? conversationPath(id) : chatPath); }
  });
  const openConversationAtMessage = useStableCallback((conversationId: string, messageId: string) => {
    openConversation(conversationId, { focusMessageId: messageId });
  });
  const newChat = useStableCallback(() => {
    if (!beforeNewChat()) return;
    openConversation(null);
    focusComposer();
  });
  const openRoom = useStableCallback((id: string) => {
    if (!beforeRoom(false)) return;
    setPendingId(null); setPendingRoomId(id); setPendingDraft(false);
    if (preview) setPreviewActiveId(null);
    else router.push(roomPath(id));
  });
  const newThreadInRoom = useStableCallback((id: string) => {
    if (!beforeRoom(true)) return;
    setPendingId(null); setPendingRoomId(id); setPendingDraft(true);
    if (preview) setPreviewActiveId(null);
    else router.push(roomDraftPath(id));
    focusComposer();
  });
  const chooseDraftRoom = useStableCallback((id: string) => {
    if (!beforeDraftRoom()) return;
    setPendingRoomId(id || null); setPendingDraft(Boolean(id));
    if (!preview) router.push(id ? roomDraftPath(id) : chatPath);
  });
  return { previewActiveId, setPreviewActiveId, pendingId, setPendingId, pendingRoomId, setPendingRoomId, pendingDraft, setPendingDraft, openConversation, openConversationAtMessage, newChat, openRoom, newThreadInRoom, chooseDraftRoom };
}
