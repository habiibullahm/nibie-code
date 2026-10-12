"use client";

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { useRouter } from "next/navigation";
import type { BrandActivity } from "@/components/brand";
import { useStableCallback } from "@/components/use-stable-callback";
import { type GenerateOptions, type Recovery, type WorkspaceData, failureNotice, droppedConnectionNotice, stillFinishingNotice } from "@/components/chat-workspace-types";
import type { PersistedMessage } from "@/lib/chat/read";
import type { ContextDiagnostics } from "@/lib/context/context-types";
import { ChatStreamServerError, readChatSse } from "@/lib/ai/sse";
import { actionRunningLabel, actionStatusLabel, actionUsedLabel } from "@/lib/actions/labels";
import { operationalCodes } from "@/lib/observability/codes";
import { weeklyLimitNotice } from "@/lib/usage/format";
import { abortLiveChatStream, finishLiveChatStream, shouldStopLiveChatOnLeave, startLiveChatStream } from "@/lib/chat/live-stream";
import { stoppedContent, type StopRequest } from "@/lib/chat/stop";
import { activeAssistantId, classifyStreamFailure, needsServerCheck } from "@/lib/chat/recovery";

const streamFlushMs = 40;
type Messages = Record<string, PersistedMessage[]>;
type StreamInput = {
  busyRef: RefObject<boolean>;
  mode: string;
  researchMode: "normal" | "deep";
  localMessages: Messages;
  latestData: RefObject<WorkspaceData | undefined>;
  activeId: string | null;
  router: ReturnType<typeof useRouter>;
  setLocalMessages: Dispatch<SetStateAction<Messages>>;
  setRemovedIds: Dispatch<SetStateAction<string[]>>;
  setContextDiagnostics: Dispatch<SetStateAction<ContextDiagnostics | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
  beginRecovery: (next: Recovery) => void;
};

export function useChatStream({ busyRef, mode, researchMode, localMessages, latestData, activeId, router, setLocalMessages, setRemovedIds, setContextDiagnostics, setNotice, beginRecovery }: StreamInput) {
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [assistantActivity, setAssistantActivity] = useState<BrandActivity>("idle");
  const streamController = useRef<AbortController | null>(null);
  const streamConversationId = useRef<string | null>(null);
  const currentConversationId = useStableCallback(() => activeId);
  const stopGeneration = useRef<(() => void) | null>(null);
  const userStopEpoch = useRef(0);
  const stoppedReplies = useRef(new Map<string, Map<string, StopRequest>>());
  useEffect(() => () => { if (shouldStopLiveChatOnLeave(window.location.pathname)) abortLiveChatStream(); }, []);
  // Back/Forward and native history updates bypass navigation callbacks. Release
  // an old thread immediately; a delayed reader must not own the newly selected view.
  const reconcileConversation = useStableCallback(() => {
    const controller = streamController.current;
    if (!controller || streamConversationId.current === activeId) return;
    controller.abort("conversation_changed");
    setContextDiagnostics(null);
    finishLiveChatStream(controller);
    streamController.current = null;
    stopGeneration.current = null;
    busyRef.current = false;
    setSending(false); setStreaming(false); setAssistantActivity("idle");
  });
  useEffect(() => { reconcileConversation(); }, [activeId, reconcileConversation]);
  // A late Stop acknowledgement failure is surfaced, but never replaces a newer turn's notice.
  const reportStopFailure = useStableCallback((id: string, error: string) => {
    if (currentConversationId() === id) setNotice((current) => current || error);
  });

  // Streams one assistant response for a saved user message. The caller owns the busy guard, which is released here.
  async function generate(id: string, userMessageId: string, options: GenerateOptions = {}) {
    const epoch = userStopEpoch.current;
    const controller = startLiveChatStream(id);
    let assistantId: string | null = null;
    let httpStatus: number | undefined;
    let weeklyLimitResetAt: string | null = null;
    let buffer = "";
    // Every reply character received, shown or still buffered; after a flush it is exactly the text on screen.
    let received = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let shown = false;
    const flush = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!buffer || !assistantId) return;
      const text = buffer; const target = assistantId; buffer = ""; shown = true;
      setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === target ? { ...message, content: message.content + text } : message) }));
    };
    const clearPlaceholder = () => { if (options.placeholderId) setLocalMessages((items) => items[id]?.some((row) => row.id === options.placeholderId) ? { ...items, [id]: items[id].filter((row) => row.id !== options.placeholderId) } : items); };
    setSending(false); setStreaming(true); setAssistantActivity("thinking");
    streamController.current = controller;
    streamConversationId.current = id;
    const stopOwnedGeneration = () => {
      if (streamController.current !== controller || controller.signal.aborted) return;
      flush();
      // The server keeps exactly this text for the stopped reply, so what the user sees now is what a reload shows.
      const stop: StopRequest = { userMessageId, assistantId, content: received };
      if (assistantId) setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId
        ? { ...message, content: stoppedContent(received), status: "interrupted", terminationReason: "user_stopped" } : message) }));
      else clearPlaceholder();
      const stops = stoppedReplies.current.get(id) ?? new Map<string, StopRequest>();
      stops.set(userMessageId, stop);
      stoppedReplies.current.set(id, stops);
      userStopEpoch.current += 1;
      controller.abort("user_stopped");
      finishLiveChatStream(controller);
      streamController.current = null;
      stopGeneration.current = null;
      busyRef.current = false;
      setSending(false); setStreaming(false); setAssistantActivity("idle");
      // The background acknowledgement is never a condition for using the composer. It is a plain request, not a
      // Server Action, because Next runs Server Actions one at a time and the next message's save must not queue behind it.
      // keepalive lets the Stop outlive a closing tab, but browsers cap keepalive bodies at 64 KiB.
      const stopBody = JSON.stringify({ conversationId: id, ...stop });
      void fetch("/api/chat/stop", { method: "POST", headers: { "content-type": "application/json" }, body: stopBody, keepalive: new Blob([stopBody]).size < 60_000 })
        .then(async (response) => {
          if (!response.ok) reportStopFailure(id, (await response.json().catch(() => null))?.error ?? failureNotice);
        }).catch(() => reportStopFailure(id, failureNotice));
    };
    stopGeneration.current = stopOwnedGeneration;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: id, userMessageId, model: mode, ...(researchMode === "deep" ? { deepResearch: true } : {}), ...(options.regenerate ? { regenerate: true } : {}), ...(options.fileIds?.length ? { fileIds: options.fileIds } : {}) }), signal: controller.signal });
      if (!response.ok || !response.body) {
        if (!response.ok) httpStatus = response.status;
        const payload = await response.json().catch(() => null);
        if (payload?.code === operationalCodes.weeklyUsageLimitRejected && typeof payload.resetAt === "string" && Number.isFinite(Date.parse(payload.resetAt))) weeklyLimitResetAt = payload.resetAt;
        throw new Error(payload?.error ?? failureNotice);
      }
      for await (const data of readChatSse(response.body)) {
        if (controller.signal.aborted) throw new DOMException("Response aborted.", "AbortError");
        if (data.type === "start") {
          assistantId = data.id;
          if (data.context) setContextDiagnostics(data.context);
          // The server has replaced the previous reply once it announces the new one, so hide the old row only now.
          if (options.replaceIds?.length) setRemovedIds((ids) => [...ids, ...options.replaceIds!]);
          const reply: PersistedMessage = {
            id: data.id,
            role: "assistant",
            content: "",
            position: data.position,
            status: "streaming",
            created_at: new Date().toISOString(),
            ...(data.sources?.length ? { sources: data.sources } : {}),
            ...(data.research ? { research: { status: "running", followUpUsed: false, searchQueryCount: 0, pagesFetched: 0, evidenceCount: 0, durationMs: 0, usagePolicy: "research_metered_v1" } } : {}),
          };
          setLocalMessages((items) => { const rows = items[id] ?? []; return { ...items, [id]: options.placeholderId && rows.some((row) => row.id === options.placeholderId) ? rows.map((row) => row.id === options.placeholderId ? reply : row) : [...rows, reply] }; });
        }
        if (data.type === "context") {
          setContextDiagnostics(data.context);
        }
        if (data.type === "progress" && assistantId) {
          setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, researchStage: data.stage, research: message.research ?? { status: "running", followUpUsed: false, searchQueryCount: 0, pagesFetched: 0, evidenceCount: 0, durationMs: 0, usagePolicy: "research_metered_v1" } } : message) }));
        }
        if (data.type === "action_start" && assistantId) {
          const label = actionRunningLabel(data.actionId);
          setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, actionId: data.actionId, actionLabel: label } : message) }));
        }
        if (data.type === "action_result" && assistantId) {
          const label = actionUsedLabel(data.actionId);
          setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, actionId: data.actionId, actionLabel: label } : message) }));
        }
        if (data.type === "action_error" && assistantId) {
          const label = actionStatusLabel(data.actionId, data.status);
          setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, actionId: data.actionId, actionLabel: label } : message) }));
        }
        if (data.type === "sources" && assistantId) {
          setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, sources: data.sources } : message) }));
        }
        if (data.type === "delta") { setAssistantActivity("streaming"); buffer += data.text; received += data.text; if (!shown) flush(); else if (!flushTimer) flushTimer = setTimeout(flush, streamFlushMs); }
        if (data.type === "status") { flush(); setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, content: message.content || "Response stopped.", status: data.status, researchStage: undefined, ...(data.status === "interrupted" ? {} : {}) } : message) })); }
      }
      flush();
      router.refresh();
    } catch (error) {
      flush();
      if (streamController.current !== controller) return;
      if (controller.signal.reason === "user_stopped" || epoch !== userStopEpoch.current) return;
      if (weeklyLimitResetAt) {
        setNotice(weeklyLimitNotice(weeklyLimitResetAt));
        return;
      }
      const kind = classifyStreamFailure({ error, aborted: controller.signal.aborted, httpStatus });
      if (!assistantId) clearPlaceholder();
      if (needsServerCheck(kind)) {
        // The outcome is not known from this side: the server saves the terminal state of every generation, so keep what is
        // on screen, lock message actions, and let the polling effect adopt the server's final state.
        if (assistantId && kind === "stopped") setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, content: message.content || "Response stopped.", status: "interrupted" } : message) }));
        setNotice(kind === "lost-connection" ? droppedConnectionNotice : kind === "in-progress" ? stillFinishingNotice : "");
        const knownAssistantId = assistantId ?? activeAssistantId([...(localMessages[id] ?? []), ...(latestData.current?.messages ?? [])]);
        beginRecovery({ conversationId: id, assistantId: knownAssistantId, baseline: latestData.current ?? { conversations: [], messages: [], activeId: id, error: null } });
      } else {
        // The server reported this failure itself, so it is final.
        if (assistantId) setLocalMessages((items) => ({ ...items, [id]: (items[id] ?? []).map((message) => message.id === assistantId ? { ...message, content: message.content || "Response unavailable.", status: "error" } : message) }));
        // Prefer the server's JSON/SSE message (for example AI spend budget) over the generic failure copy.
        const serverMessage =
          error instanceof ChatStreamServerError || (kind === "request-failed" && error instanceof Error)
            ? error.message.trim()
            : "";
        setNotice(serverMessage || failureNotice);
        router.refresh();
      }
    } finally {
      clearPlaceholder();
      if (flushTimer) clearTimeout(flushTimer);
      finishLiveChatStream(controller);
      if (stopGeneration.current === stopOwnedGeneration) stopGeneration.current = null;
      if (epoch === userStopEpoch.current && streamController.current === controller) {
        streamController.current = null;
        busyRef.current = false;
        setSending(false); setStreaming(false); setAssistantActivity("idle");
      }
    }
  }
  const stopStream = useStableCallback(() => stopGeneration.current?.());
  return { sending, setSending, streaming, setStreaming, assistantActivity, streamController, userStopEpoch, stoppedReplies, generate, stopStream };
}
