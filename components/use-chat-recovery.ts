"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { useRouter } from "next/navigation";
import type { PersistedMessage } from "@/lib/chat/read";
import { hasActiveGeneration, latestReplyFailed, recoveryPollAction, recoveryPollMs } from "@/lib/chat/recovery";
import { type Recovery, type WorkspaceData, checkAgainNotice, failureNotice, unconfirmedNotice } from "@/components/chat-workspace-types";

export function useChatRecovery(initialData: WorkspaceData | undefined, router: ReturnType<typeof useRouter>, setNotice: Dispatch<SetStateAction<string>>) {
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const recoveryEpoch = useRef(0);
  const [acceptedMessages, setAcceptedMessages] = useState<PersistedMessage[]>(initialData?.messages ?? []);
  const acceptedMessagesRef = useRef(acceptedMessages);
  useEffect(() => { acceptedMessagesRef.current = acceptedMessages; }, [acceptedMessages]);
  const latestData = useRef(initialData);
  useLayoutEffect(() => { latestData.current = initialData; });
  const beginRecovery = (next: Recovery) => { recoveryEpoch.current += 1; setRecovery(next); };
  const recoveryConversationId = recovery?.conversationId ?? null;
  useEffect(() => {
    if (!recoveryConversationId) return;
    const epoch = recoveryEpoch.current;
    let polls = 0;
    let awaitingFinal = false;
    let snapshotAtFinal: PersistedMessage[] | null = null;
    let finalWaits = 0;
    const readAuthoritative = () => {
      const data = latestData.current;
      if (data && data.activeId === recoveryConversationId) return data.messages;
      return acceptedMessagesRef.current;
    };
    router.refresh();
    const timer = setInterval(() => {
      if (epoch !== recoveryEpoch.current) { clearInterval(timer); return; }
      const authoritative = readAuthoritative();
      if (awaitingFinal) {
        finalWaits += 1;
        const arrived = authoritative !== snapshotAtFinal;
        if (!arrived && finalWaits < 4) return;
        clearInterval(timer);
        // A streaming row after the authoritative read is still in progress. Stop polling, but do not unlock Retry.
        if (!arrived || hasActiveGeneration(authoritative)) { setNotice(checkAgainNotice); return; }
        setRecovery(null);
        setNotice(latestReplyFailed(authoritative) ? failureNotice : "");
        return;
      }
      polls += 1;
      const action = recoveryPollAction(polls, authoritative);
      if (action === "final-check") {
        awaitingFinal = true;
        snapshotAtFinal = authoritative;
        router.refresh();
        return;
      }
      if (action === "give-up") {
        clearInterval(timer);
        const messages = authoritative;
        if (hasActiveGeneration(messages)) { setNotice(checkAgainNotice); return; }
        setRecovery(null);
        setNotice(!messages.some((message) => message.role === "assistant" && message.status && message.status !== "streaming") ? unconfirmedNotice : latestReplyFailed(messages) ? failureNotice : "");
        return;
      }
      router.refresh();
    }, recoveryPollMs);
    return () => clearInterval(timer);
  }, [recoveryConversationId, router, setNotice]);
  return { recovery, setRecovery, beginRecovery, acceptedMessages, setAcceptedMessages, latestData };
}
