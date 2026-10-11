"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, SquarePen, X } from "lucide-react";
import { addUserMessageAction, archiveConversationAction, editLastUserMessageAction, moveConversationAction, renameConversationAction, restoreConversationAction, startConversationAction, updateConversationModelAction } from "@/app/actions/chat";
import { createWorkbenchFromAssistantAction } from "@/app/actions/workbench";
import { WORKBENCH_UI_ENABLED } from "@/lib/workbench/flags";
import { ChatComposer, type ComposerHandle } from "@/components/chat-composer";
import { ChatSidebar } from "@/components/chat-sidebar";
import { RoomDetail } from "@/components/room-detail";
import { RoomCreateDialog } from "@/components/room-create-dialog";
import { RoomFilePicker } from "@/components/room-file-picker";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import type { SettingsSectionId } from "@/components/settings/registry";
import { MessageRow } from "@/components/message-row";
import { WorkbenchPanel } from "@/components/workbench-panel";
import { forgetLastConversationId, readChatFlag, subscribeChatPreferences, writeLastConversationId } from "@/components/use-chat-preferences";
import { useStableCallback } from "@/components/use-stable-callback";
import type { WhatsNewPreview } from "@/lib/changelog";
import type { ConversationSummary, PersistedMessage, RoomSummary } from "@/lib/chat/read";
import type { AttachmentSummary } from "@/lib/attachments/types";
import type { ModelChoice, ModelOption } from "@/lib/chat/models";
import { roomContextFromRows } from "@/lib/rooms/map";
import { conversationPath } from "@/lib/routes";
import { clearStoredConversationReference } from "@/lib/privacy/local-state";
import { modelForComposer } from "@/lib/preferences/model";
import { accountDisplayName } from "@/lib/auth/display-name";
import { defaultUserPreferences, type UserPreferences } from "@/lib/preferences/types";
import { createPreviewArchivedConversations, createPreviewConversations } from "@/lib/chat/preview-data";
import {
  TRANSCRIPT_LOAD_ERROR,
  TRANSCRIPT_NOT_FOUND_ERROR,
  TRANSCRIPT_OVERSIZE_ERROR,
  buildTranscriptText,
} from "@/lib/chat/transcript";
import { writePlainClipboard } from "@/lib/markdown/clipboard";
import { previewContextDiagnostics } from "@/lib/context/profile-context";
import type { ContextDiagnostics } from "@/lib/context/context-types";
import { followAfterSending, followStreamedContent, isNearBottom, trackNearBottom } from "@/lib/chat/scroll";
import { compareText } from "@/lib/chat/order";
import { readRoomFileSelection, rememberRoomFileSelection } from "@/lib/files/selection-memory";
import { abortLiveChatStream, liveChatConversationId } from "@/lib/chat/live-stream";
import { suppressSupersededPendingAssistants } from "@/lib/chat/optimistic";
import { activeAssistantId, isRecoverySettled, isRegressiveSnapshot, latestReplyFailed, messagePersistenceConfirmed, unseenGenerationSettled } from "@/lib/chat/recovery";

import { type Conversation, type WorkspaceData, failureNotice, unconfirmedNotice, stillFinishingNotice, droppedConnectionNotice } from "@/components/chat-workspace-types";
import { useChatRecovery } from "@/components/use-chat-recovery";
import { useConversationNavigation } from "@/components/use-conversation-navigation";
import { useRoomManagement } from "@/components/use-room-management";
import { useChatStream } from "@/components/use-chat-stream";
const welcomeGreetings = [
  (name: string | null) => name ? `Hey, ${name}.` : "Hey there.",
  (name: string | null) => name ? `Good to see you, ${name}.` : "Good to see you.",
  (name: string | null) => name ? `Welcome back, ${name}.` : "Welcome back.",
  (name: string | null) => name ? `Glad you're here, ${name}.` : "Glad you're here.",
  (name: string | null) => name ? `Hello again, ${name}.` : "Hello again.",
] as const;
const noConversations: ConversationSummary[] = [];
const previewStamp = "2026-10-01T08:30:00.000Z";
const previewRoomId = "preview-room-nibie";
const mockRooms: RoomSummary[] = [
  { id: previewRoomId, name: "Nibie Development", description: "The product and the context engine.", instructions: "Keep the voice calm and specific.", created_at: previewStamp, updated_at: previewStamp, brief: { goal: "Ship Rooms", current_focus: "Room detail", important_decisions: null, open_questions: null, next_step: "Keep general threads working" }, pins: [{ id: "preview-pin-deploy", room_id: previewRoomId, title: "Deployment rule", content: "Production runs on Vercel Seoul and user data stays owner-scoped through Supabase RLS.", created_at: previewStamp, updated_at: previewStamp }] },
];

const noModels: ModelOption[] = [];

export function ChatWorkspace({ email, metadataName = null, initialData, preview = false, models = noModels, renderedAt, preferences, preferencesError = null, releasePreview = null }: { email: string; metadataName?: string | null; initialData?: WorkspaceData; preview?: boolean; models?: ModelOption[]; renderedAt?: number; preferences?: UserPreferences; preferencesError?: string | null; releasePreview?: WhatsNewPreview | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationParam = searchParams.get("conversation");
  const roomParam = searchParams.get("room");
  const draftParam = searchParams.get("draft") === "1";
  // Server history captured at delete-all. It stays hidden until a newer server payload arrives, so deleted chats do not flash back.
  const [droppedServerHistory, setDroppedServerHistory] = useState<WorkspaceData | null>(null);
  const previewConversations = useMemo(() => createPreviewConversations(renderedAt ?? 0), [renderedAt]);
  const previewArchivedConversations = useMemo(() => createPreviewArchivedConversations(renderedAt ?? 0), [renderedAt]);
  const conversations = preview ? previewConversations : initialData && initialData === droppedServerHistory ? noConversations : (initialData?.conversations ?? noConversations);
  const archivedConversations = preview ? previewArchivedConversations : initialData?.archivedConversations ?? noConversations;
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<Record<string, PersistedMessage[]>>({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const renameTitleId = useId();
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [localConversations, setLocalConversations] = useState<ConversationSummary[]>([]);
  const [locallyArchivedIds, setLocallyArchivedIds] = useState<string[]>([]);
  const [welcomeGreetingIndex, setWelcomeGreetingIndex] = useState(0);
  // A conversation's saved mode is only used while that mode is still configured; otherwise the first available one is shown.
  const availableModes = useMemo(() => models.map((option) => option.id), [models]);
  const [modelChoice, setModelChoice] = useState<ModelChoice>("Auto");
  const [savingMode, setSavingMode] = useState(false);
  const [savedPreferences, setSavedPreferences] = useState(preferences ?? defaultUserPreferences());
  const [serverUpdatedAt, setServerUpdatedAt] = useState(preferences?.updatedAt ?? null);
  if (preferences && preferences.updatedAt !== serverUpdatedAt) {
    setServerUpdatedAt(preferences.updatedAt);
    setSavedPreferences(preferences);
  }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [contextDiagnostics, setContextDiagnostics] = useState<ContextDiagnostics | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const modeFor = (saved: string | undefined, hasConversation: boolean) => modelForComposer({
    hasConversation,
    conversationModel: saved,
    accountDefault: savedPreferences.defaultModel,
    available: availableModes,
  }) ?? "Balanced";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [workbenchDocumentId, setWorkbenchDocumentId] = useState<string | null>(null);
  const [workbenchPending, setWorkbenchPending] = useState(false);
  const workbenchOpeningRef = useRef(false);
  const sidebarCollapsedBeforeWorkbench = useRef<boolean | null>(null);
  const desktopCollapseButtonRef = useRef<HTMLButtonElement>(null);
  const desktopExpandButtonRef = useRef<HTMLButtonElement>(null);
  const [movingThread, setMovingThread] = useState<string | null>(null);
  const movePending = useRef(false);
  const [researchMode, setResearchMode] = useState<"normal" | "deep">("normal");
  // This guard also covers saves and model/move mutations outside the stream.
  const busy = useRef(false);
  const submission = useRef<{ id: string; content: string; conversationId: string | null; attachmentIds: string } | null>(null);
  const [serverData, setServerData] = useState(initialData);
  const [notice, setNotice] = useState(initialData?.error ?? "");
  const { recovery, setRecovery, beginRecovery, acceptedMessages, setAcceptedMessages, latestData } = useChatRecovery(initialData, router, setNotice);
  const composerRef = useRef<ComposerHandle>(null);
  useEffect(() => {
    if (!renaming) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = renameDialogRef.current;
    dialog?.showModal();
    dialog?.querySelector("input")?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, [renaming]);
  // The conversation follows new content while auto-follow is on and the reader is near the bottom (see lib/chat/scroll.ts).
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const scrollViewportHeightRef = useRef<number | null>(null);
  const followRef = useRef(true);
  const autoFollowRef = useRef(readChatFlag("autoFollow"));
  const pinLatestRef = useRef(true);
  const handleScroll = useStableCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    // A composer resize can fire scroll before ResizeObserver restores the bottom; it is not a reader scrolling up.
    if (scrollViewportHeightRef.current !== null && scrollViewportHeightRef.current !== viewport.clientHeight) return;
    followRef.current = trackNearBottom(autoFollowRef.current, isNearBottom(viewport));
  });
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const shownConversations = useMemo(() => [...new Map([...conversations, ...localConversations].map((item) => [item.id, item])).values()]
    .filter((item) => !locallyArchivedIds.includes(item.id))
    .sort((left, right) => compareText(right.updated_at, left.updated_at) || compareText(left.id, right.id)), [conversations, localConversations, locallyArchivedIds]);
  const { previewActiveId, setPreviewActiveId, pendingId, setPendingId, pendingRoomId, setPendingRoomId, pendingDraft, setPendingDraft, openConversation, openConversationAtMessage, newChat, openRoom, newThreadInRoom, chooseDraftRoom } = useConversationNavigation({ preview, conversationParam, roomParam, draftParam, router, pinLatestRef, getLatestData: () => latestData.current, beforeConversation, beforeRoom, beforeNewChat, beforeDraftRoom, focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus()) });
  function resetNavigationView() {
    setNotice(""); setDrawerOpen(false); setEditingId(null); setRecovery(null); setContextDiagnostics(null);
  }
  function beforeConversation(id: string | null, options?: { focusMessageId?: string }) {
    setModelChoice("Auto");
    if (busy.current && !streamController.current && liveChatConversationId() !== id) return false;
    if (id !== liveChatConversationId()) abortLiveChatStream();
    resetNavigationView();
    setFocusMessageId(options?.focusMessageId ?? null);
    pinLatestRef.current = !options?.focusMessageId;
    requestAnimationFrame(() => menuButtonRef.current?.focus());
    return true;
  }
  function beforeNewChat() {
    if (busy.current) return false;
    setWelcomeGreetingIndex((index) => (index + 1) % welcomeGreetings.length);
    composerRef.current?.clear();
    return true;
  }
  function beforeRoom(draft: boolean) {
    if (draft) {
      setModelChoice("Auto");
      if (busy.current) return false;
      composerRef.current?.clear();
    } else if (busy.current && !streamController.current && !liveChatConversationId()) return false;
    resetNavigationView(); pinLatestRef.current = true;
    return true;
  }
  function beforeDraftRoom() {
    if (activeId || busy.current || recovery) return false;
    setContextDiagnostics(null); setNotice("");
    return true;
  }
  const { rooms, createRoom, saveRoom, saveBrief, createPin, updatePin, removePin, removeRoom, deleteRoomFromSidebar } = useRoomManagement({ preview, serverRooms: initialData?.rooms, mockRooms, router, getActiveRoom: () => activeRoom, onCreated: (id) => openRoom(id), onDeleted: roomDeleted, setNotice });
  function roomDeleted(id: string) {
    setLocalConversations((items) => {
      const map = new Map(items.map((item) => [item.id, item]));
      for (const item of shownConversations) if (item.room_id === id) map.set(item.id, { ...item, room_id: null });
      return [...map.values()];
    });
    if (activeRoom?.id === id) openConversation(null);
  }
  const paramActiveId = shownConversations.some((item) => item.id === conversationParam) ? conversationParam : null;
  const activeId = preview ? previewActiveId : pendingId !== undefined ? pendingId : paramActiveId;
  // Keep an unavailable draft room selected until the user explicitly changes it; never silently send in General.
  const paramRoomId = draftParam || rooms.some((room) => room.id === roomParam) ? roomParam : null;
  const selectedRoomId = pendingRoomId !== undefined ? pendingRoomId : paramRoomId;
  const drafting = (pendingDraft !== undefined ? pendingDraft : draftParam) && Boolean(selectedRoomId) && !activeId;
  const showRoom = Boolean(selectedRoomId) && !activeId && !drafting;
  const activeRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const activeConversation = shownConversations.find((item) => item.id === activeId);
  const selectedModel = modelChoice !== "Auto" && availableModes.includes(modelChoice) ? modelChoice : "Auto";
  const mode = selectedModel === "Auto" ? modeFor(activeConversation?.selected_model, Boolean(activeId)) : selectedModel;
  const { sending, setSending, streaming, setStreaming, assistantActivity, streamController, userStopEpoch, stoppedReplies, generate, stopStream } = useChatStream({ busyRef: busy, mode, researchMode, localMessages, latestData, activeId, router, setLocalMessages, setRemovedIds, setContextDiagnostics, setNotice, beginRecovery });
  // Only High asks the model to reason, so only High says "Thinking…" while waiting for the first token.
  const waitLabel = researchMode === "deep" ? "Researching…" : mode === "High" ? "Thinking…" : "Responding…";
  const savedMessages = activeId === initialData?.activeId ? initialData?.messages : undefined;
  const activeLocal = localMessages[activeId ?? ""];
  const previewMessages = (activeConversation as Conversation | undefined)?.messages;
  const messages = useMemo(() => preview
    ? [...(previewMessages ?? []), ...(activeLocal ?? [])]
    : suppressSupersededPendingAssistants([...new Map([...(savedMessages ?? []), ...(activeLocal ?? [])].map((message) => [message.id, message])).values()]).filter((message) => !removedIds.includes(message.id)).sort((left, right) => left.position - right.position),
  [preview, previewMessages, activeLocal, savedMessages, removedIds]);
  const loadingConversation = !preview && pendingId != null && initialData?.activeId !== pendingId && !activeLocal?.length;
  const centeredComposer = !showRoom && !loadingConversation && messages.length === 0;
  const lastMessage = messages[messages.length - 1];
  const lastUser = useMemo(() => [...messages].reverse().find((message) => message.role === "user"), [messages]);
  const recovering = recovery !== null;
  const controlsDisabled = sending || streaming || movingThread !== null;
  // Message actions stay locked until the server confirms how the last response ended, so they cannot collide with it.
  const messageActionsLocked = controlsDisabled || recovering;
  const initial = email.slice(0, 1).toUpperCase();
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (pinLatestRef.current) {
      if (loadingConversation) return;
      box.scrollTop = box.scrollHeight;
      pinLatestRef.current = false;
      followRef.current = trackNearBottom(autoFollowRef.current, isNearBottom(box));
      return;
    }
    if (followStreamedContent(autoFollowRef.current, followRef.current)) box.scrollTop = box.scrollHeight;
  }, [messages, activeId, loadingConversation]);

  useEffect(() => {
    if (centeredComposer || showRoom) return;
    const viewport = scrollRef.current;
    const dock = composerDockRef.current;
    if (!viewport || !dock || typeof ResizeObserver === "undefined") return;
    scrollViewportHeightRef.current = viewport.clientHeight;
    const observer = new ResizeObserver(() => {
      scrollViewportHeightRef.current = viewport.clientHeight;
      if (autoFollowRef.current && followRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(dock);
    observer.observe(viewport);
    return () => { observer.disconnect(); scrollViewportHeightRef.current = null; };
  }, [centeredComposer, showRoom]);

  const serverSnapshot = initialData && initialData.activeId === (recovery?.conversationId ?? activeId) && !isRegressiveSnapshot(acceptedMessages, initialData.messages) ? initialData : null;
  if (serverSnapshot && serverSnapshot.messages !== acceptedMessages) setAcceptedMessages(serverSnapshot.messages);
  const baselineMessages = recovery?.baseline?.messages ?? [];
  const recoverySettled = Boolean(recovery && serverSnapshot && serverSnapshot !== recovery.baseline && (recovery.assistantId ? isRecoverySettled(serverSnapshot.messages, recovery.assistantId, baselineMessages) : unseenGenerationSettled(baselineMessages, serverSnapshot.messages)));
  if (recovery && serverSnapshot && recoverySettled) {
    // Fresh server data says the response is settled: show the server's truth and drop any stale failure notice.
    setRecovery(null);
    setNotice(latestReplyFailed(serverSnapshot.messages) ? failureNotice : "");
    setServerData(serverSnapshot);
    setLocalMessages((items) => { const next = { ...items }; delete next[recovery.conversationId]; return next; });
    setRemovedIds([]);
  }

  if (!preview && serverSnapshot && serverSnapshot !== serverData && serverSnapshot.activeId === activeId && !sending && !streaming && !recoverySettled) {
    const pending = localMessages[serverSnapshot?.activeId ?? ""] ?? [];
    const settled = pending.every((message) => serverSnapshot?.messages.some((saved) => saved.id === message.id && messagePersistenceConfirmed(message, saved)));
    if (settled && removedIds.every((id) => !serverSnapshot?.messages.some((saved) => saved.id === id))) {
      setServerData(serverSnapshot);
      setLocalMessages({});
      setRemovedIds([]);
      setLocalConversations([]);
      if (serverSnapshot?.error) setNotice(serverSnapshot.error);
      else if (!latestReplyFailed(serverSnapshot.messages) && (notice === unconfirmedNotice || notice === stillFinishingNotice || notice === droppedConnectionNotice)) setNotice("");
    }
  }

  // Only the view that streams a reply can finish it. A reply the server still reports as streaming with no stream here (the thread
  // was opened or reloaded mid-reply, or a hard navigation dropped the live stream) is followed like a recovery until the server
  // reports how it ended; otherwise it stays on the claim placeholder without Stop or Copy until a manual reload.
  const unownedReply = !preview && activeId && !sending && !streaming && !recovery ? activeAssistantId(messages) : null;
  if (unownedReply && activeId) setRecovery({ conversationId: activeId, assistantId: unownedReply, baseline: initialData });

  useEffect(() => { if (drafting) composerRef.current?.focus(); }, [drafting, selectedRoomId]);
  useEffect(() => subscribeChatPreferences(() => {
    autoFollowRef.current = readChatFlag("autoFollow");
    const box = scrollRef.current;
    followRef.current = trackNearBottom(autoFollowRef.current, box ? isNearBottom(box) : false);
  }), []);
  useEffect(() => {
    if (preview || !activeId || !shownConversations.some((item) => item.id === activeId)) return;
    writeLastConversationId(activeId);
  }, [activeId, preview, shownConversations]);
  useEffect(() => {
    if (!drawerOpen) return;
    closeMenuRef.current?.focus();
    function handleKeydown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { setDrawerOpen(false); menuButtonRef.current?.focus(); return; }
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [drawerOpen]);

  // The backend mode comes from the persisted thread or the account default for a fresh chat.
  useEffect(() => {
    if (!focusMessageId || loadingConversation) return;
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focusMessageId)}"]`);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    target.classList.add("is-search-highlight");
    const timer = window.setTimeout(() => {
      target.classList.remove("is-search-highlight");
      setFocusMessageId(null);
    }, 2_000);
    return () => {
      window.clearTimeout(timer);
      target.classList.remove("is-search-highlight");
    };
  }, [focusMessageId, messages, loadingConversation, activeId]);
  // New chat opens the empty conversation immediately. The conversation row is created with the first message, so there is no
  // server work (and no empty "New chat" entries left in history) until the user actually sends something.
  const conversationsDeleted = useStableCallback(() => {
    abortLiveChatStream();
    busy.current = false;
    setSending(false);
    setStreaming(false);
    clearStoredConversationReference(typeof window === "undefined" ? null : window.localStorage);
    setDroppedServerHistory(latestData.current ?? null);
    setLocalConversations([]);
    setLocalMessages({});
    setRemovedIds([]);
    setEditingId(null);
    setRecovery(null);
    setNotice("");
    setSettingsOpen(false);
    openConversation(null);
    router.refresh();
  });

  const submitMessage = useStableCallback(async (content: string, attachments: AttachmentSummary[] = []) => {
    if (!content || busy.current || recovery || movePending.current) return;
    if (!activeId && selectedRoomId && !activeRoom) {
      setNotice("That room is no longer available. Choose General or another room before sending.");
      return;
    }
    const epoch = userStopEpoch.current;
    busy.current = true;
    setSending(true); setNotice(""); setEditingId(null); followRef.current = followAfterSending(autoFollowRef.current);
    let id = activeId;
    try {
      if (preview) {
        const id = activeId ?? `preview-local-${crypto.randomUUID()}`;
        const item = activeConversation ?? { id, title: content.slice(0, 42), selected_model: mode, room_id: selectedRoomId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        const row: PersistedMessage = { id: `local-${crypto.randomUUID()}`, role: "user", content, position: messages.length + 1, created_at: new Date().toISOString() };
        if (!activeConversation) setLocalConversations((items) => [item, ...items]);
        setLocalMessages((items) => ({ ...items, [id]: [...(items[id] ?? []), row] }));
        setPreviewActiveId(id); composerRef.current?.clear(); setNotice("Your message is shown in this local preview. Replies are not connected yet.");
        return;
      }
      // The same submission keeps the same message id, so a retry after a failure can never save the message twice.
      const attachmentIds = attachments.map((attachment) => attachment.id);
      const attachmentKey = attachmentIds.join(",");
      const messageId = submission.current && submission.current.content === content && submission.current.conversationId === id && submission.current.attachmentIds === attachmentKey ? submission.current.id : crypto.randomUUID();
      submission.current = { id: messageId, content, conversationId: id, attachmentIds: attachmentKey };
      // Attachment ids are sent only with attachments, so a plain message keeps its existing action arguments.
      const withAttachments = attachmentIds.length ? [attachmentIds] as const : [] as const;
      const placeholderId = `pending-${messageId}`;
      const basePosition = lastMessage?.position ?? 0;
      const withoutPending = (rows: PersistedMessage[] = []) => rows.filter((row) => row.id !== messageId && row.id !== placeholderId);
      // Show the message and a thinking row immediately; the server confirms (or we roll back and restore the draft) below.
      const key = id ?? "";
      const stamped = new Date().toISOString();
      setLocalMessages((items) => ({ ...items, [key]: [...withoutPending(items[key]), { id: messageId, role: "user", content, position: basePosition + 1, status: "complete", created_at: stamped, ...(attachments.length ? { attachments } : {}) }, { id: placeholderId, role: "assistant", content: "", position: basePosition + 2, status: "streaming", created_at: stamped }] }));
      composerRef.current?.clear();
      const rollback = (message: string, from: string) => { setLocalMessages((items) => ({ ...items, [from]: withoutPending(items[from]) })); composerRef.current?.restore(content, attachments); setNotice(message); };
      let saved: { id: string; position: number };
      if (!id) {
        // The first message of a new chat creates the conversation and saves the message in a single round trip.
        const started = await startConversationAction(mode, messageId, content, drafting ? selectedRoomId : null, ...withAttachments);
        if (started.error || !started.data) { rollback(started.error ?? "Conversation couldn't be created.", key); return; }
        const { conversation } = started.data;
        saved = started.data.message;
        id = conversation.id;
        setLocalConversations((items) => [conversation, ...items]);
        setLocalMessages((items) => { const { "": rows = [], ...rest } = items; return { ...rest, [conversation.id]: rows }; });
        setPendingId(conversation.id);
        setPendingRoomId(null);
        setPendingDraft(false);
        router.push(conversationPath(conversation.id));
      } else {
        const stopped = [...(stoppedReplies.current.get(id)?.values() ?? [])];
        const result = await addUserMessageAction(id, content, messageId, stopped, ...withAttachments);
        if (result.error || !result.data) { rollback(result.error ?? "Message couldn't be saved.", id); return; }
        saved = result.data;
        const pendingStops = stoppedReplies.current.get(id);
        for (const stop of stopped) if (pendingStops?.get(stop.userMessageId) === stop) pendingStops.delete(stop.userMessageId);
        if (!pendingStops?.size) stoppedReplies.current.delete(id);
      }
      submission.current = null;
      setLocalMessages((items) => ({ ...items, [id!]: (items[id!] ?? []).map((row) => row.id === messageId ? { ...row, position: saved.position } : row.id === placeholderId ? { ...row, position: saved.position + 1 } : row) }));
      setLocalConversations((items) => items.map((item) => item.id === id ? { ...item, title: item.title === "New chat" ? content.slice(0, 42) + (content.length > 42 ? "…" : "") : item.title, updated_at: new Date().toISOString() } : item));
      const fileIds = selectedFileIds;
      rememberRoomFileSelection(messageId, fileIds);
      await generate(id, messageId, { placeholderId, fileIds });
    } catch {
      setNotice("Nibie couldn't complete that response. Please try again.");
      if (!preview) router.refresh();
    } finally { if (epoch === userStopEpoch.current) { busy.current = false; setSending(false); } }
  });

  // Last-turn controls: only the latest user message can be edited, and only its reply can be regenerated.
  function repliesAfter(message: PersistedMessage) { return messages.filter((item) => item.role === "assistant" && item.position > message.position).map((item) => item.id); }
  const regenerate = useStableCallback(async () => {
    if (preview || busy.current || recovery || !activeId || !lastUser) return;
    const epoch = userStopEpoch.current;
    busy.current = true; setSending(true); setNotice(""); setEditingId(null); followRef.current = followAfterSending(autoFollowRef.current);
    try { await generate(activeId, lastUser.id, { regenerate: true, replaceIds: repliesAfter(lastUser), fileIds: readRoomFileSelection(lastUser.id) }); }
    finally { if (epoch === userStopEpoch.current) { busy.current = false; setSending(false); } }
  });
  const saveEdit = useStableCallback(async (messageId: string, content: string) => {
    if (preview || busy.current || recovery || !activeId || !lastUser || lastUser.id !== messageId || !content || content === lastUser.content) return;
    const epoch = userStopEpoch.current;
    const id = activeId; const target = lastUser; const replaceIds = repliesAfter(target);
    busy.current = true; setSending(true); setNotice(""); followRef.current = followAfterSending(autoFollowRef.current);
    try {
      const result = await editLastUserMessageAction(id, target.id, content);
      if (result.error || !result.data) { setNotice(result.error ?? "Your edit couldn't be saved."); return; }
      setEditingId(null);
      setRemovedIds((ids) => [...ids, ...replaceIds]);
      setLocalMessages((items) => ({ ...items, [id]: [{ id: target.id, role: "user", content, position: target.position, status: "complete", created_at: target.created_at }] }));
      rememberRoomFileSelection(target.id, selectedFileIds);
      await generate(id, target.id, { fileIds: selectedFileIds });
    } catch {
      setNotice("Nibie couldn't complete that response. Please try again.");
      router.refresh();
    } finally { if (epoch === userStopEpoch.current) { busy.current = false; setSending(false); } }
  });
  const rename = useStableCallback((item: ConversationSummary) => {
    if (preview) return;
    setRenameTitle(item.title);
    setRenameError("");
    setRenaming(item);
  });
  const saveRename = useStableCallback(async () => {
    if (!renaming || renameSaving) return;
    const title = renameTitle.trim();
    if (!title) { setRenameError("Enter a conversation title."); return; }
    setRenameSaving(true);
    setRenameError("");
    try {
      const result = await renameConversationAction(renaming.id, title);
      if (result.error) { setRenameError(result.error); return; }
      const item = renaming;
      setRenaming(null);
      setLocalConversations((items) => {
        const renamed = { ...item, title, updated_at: new Date().toISOString() };
        return items.some((entry) => entry.id === item.id) ? items.map((entry) => entry.id === item.id ? renamed : entry) : [renamed, ...items];
      });
      router.refresh();
    } catch {
      setRenameError("Conversation title couldn't be saved. Please try again.");
    } finally {
      setRenameSaving(false);
    }
  });
  const archive = useStableCallback(async (item: ConversationSummary) => {
    if (busy.current && item.id === activeId) return;
    if (preview) return;
    const result = await archiveConversationAction(item.id);
    if (result.error) { setNotice(result.error); return; }
    forgetLastConversationId(item.id);
    setLocallyArchivedIds((ids) => ids.includes(item.id) ? ids : [...ids, item.id]);
    setLocalConversations((items) => items.filter((entry) => entry.id !== item.id));
    if (activeId === item.id) openConversation(null);
    router.refresh();
  });
  const restore = useStableCallback(async (item: ConversationSummary) => {
    if (preview) {
      const archived = previewArchivedConversations.find((entry) => entry.id === item.id);
      const restored = { ...(archived ?? item), archived_at: null };
      setLocalConversations((items) => items.some((entry) => entry.id === item.id) ? items : [restored, ...items]);
      return;
    }
    const result = await restoreConversationAction(item.id);
    if (result.error) { setNotice(result.error); return; }
    setLocallyArchivedIds((ids) => ids.filter((id) => id !== item.id));
    router.refresh();
  });
  const transcriptBusy = useRef(false);
  const previewMessagesFor = useStableCallback((item: ConversationSummary) => {
    const conversation = previewConversations.find((entry) => entry.id === item.id);
    if (!conversation) return null;
    return conversation.messages.map((message, index) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status ?? "complete",
      position: message.position ?? index + 1,
      created_at: message.created_at ?? previewStamp,
    }));
  });
  const copyTranscript = useStableCallback(async (item: ConversationSummary) => {
    if (transcriptBusy.current) return;
    transcriptBusy.current = true;
    setNotice("");
    try {
      if (preview) {
        const messages = previewMessagesFor(item);
        if (!messages) { setNotice(TRANSCRIPT_NOT_FOUND_ERROR); return; }
        const built = buildTranscriptText({ id: item.id, title: item.title }, messages, "plain");
        if ("error" in built) { setNotice(built.error); return; }
        await writePlainClipboard(built.text);
        setNotice("Transcript copied.");
        return;
      }
      const response = await fetch(`/api/conversations/${item.id}/transcript`, {
        headers: { accept: "text/plain" },
      });
      if (response.status === 401) { setNotice("Your session has expired. Please sign in again."); return; }
      if (response.status === 404) { setNotice(TRANSCRIPT_NOT_FOUND_ERROR); return; }
      if (response.status === 413) { setNotice(TRANSCRIPT_OVERSIZE_ERROR); return; }
      if (!response.ok) { setNotice(TRANSCRIPT_LOAD_ERROR); return; }
      await writePlainClipboard(await response.text());
      setNotice("Transcript copied.");
    } catch {
      setNotice(TRANSCRIPT_LOAD_ERROR);
    } finally {
      transcriptBusy.current = false;
    }
  });
  const moveThread = useStableCallback(async (item: ConversationSummary, roomId: string | null) => {
    if (busy.current || recovery || movePending.current) return;
    const previous = shownConversations.find((entry) => entry.id === item.id);
    if (!previous || previous.room_id === roomId || previous.archived_at) return;
    if (roomId && !rooms.some((room) => room.id === roomId)) { setNotice("That room is no longer available."); return; }
    movePending.current = true;
    setMovingThread(item.id);
    const next = { ...previous, room_id: roomId, updated_at: new Date().toISOString() };
    const rollback = (message: string) => {
      setLocalConversations((items) => items.map((entry) => entry.id === item.id ? previous : entry));
      setNotice(message);
    };
    if (activeId === item.id) setContextDiagnostics(null);
    setNotice("");
    setLocalConversations((items) => items.some((entry) => entry.id === item.id) ? items.map((entry) => entry.id === item.id ? next : entry) : [next, ...items]);
    try {
      if (!preview) {
        const result = await moveConversationAction(item.id, roomId);
        if (result.error) { rollback(result.error); return; }
      }
      // File choices belong to the room in which the message was sent; never reuse them after a context move.
      for (const message of [...(localMessages[item.id] ?? []), ...(item.id === initialData?.activeId ? initialData.messages : [])]) {
        if (message.role === "user") rememberRoomFileSelection(message.id, []);
      }
      if (!preview) router.refresh();
    } catch {
      rollback("We couldn't save that change. Please try again.");
    } finally { movePending.current = false; setMovingThread(null); }
  });
  const changeComposerRoom = useStableCallback((id: string) => {
    if (activeConversation) void moveThread(activeConversation, id || null);
    else chooseDraftRoom(id);
  });
  const closeDrawer = useStableCallback(() => { setDrawerOpen(false); menuButtonRef.current?.focus(); });
  const collapseDesktopSidebar = useStableCallback(() => { setDesktopSidebarCollapsed(true); requestAnimationFrame(() => desktopExpandButtonRef.current?.focus()); });
  const closeWorkbenchPanel = useStableCallback(() => {
    setWorkbenchDocumentId(null);
    if (sidebarCollapsedBeforeWorkbench.current !== null) {
      setDesktopSidebarCollapsed(sidebarCollapsedBeforeWorkbench.current);
      sidebarCollapsedBeforeWorkbench.current = null;
    }
  });
  const editInWorkbench = useStableCallback(async (messageId: string) => {
    if (!WORKBENCH_UI_ENABLED || preview || workbenchOpeningRef.current) return;
    workbenchOpeningRef.current = true;
    setWorkbenchPending(true);
    try {
      const result = await createWorkbenchFromAssistantAction(messageId);
      if (result.error || !result.data) {
        setNotice(result.error ?? failureNotice);
        return;
      }
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches && !desktopSidebarCollapsed) {
        sidebarCollapsedBeforeWorkbench.current = desktopSidebarCollapsed;
        setDesktopSidebarCollapsed(true);
      }
      setWorkbenchDocumentId(result.data.id);
    } finally {
      workbenchOpeningRef.current = false;
      setWorkbenchPending(false);
    }
  });
  const expandDesktopSidebar = useStableCallback(() => { setDesktopSidebarCollapsed(false); requestAnimationFrame(() => desktopCollapseButtonRef.current?.focus()); });
  const openRoomSetup = useStableCallback(() => { setDrawerOpen(false); setCreatingRoom(true); });
  const closeRoomSetup = useStableCallback(() => setCreatingRoom(false));
  const openSettings = useStableCallback(() => { setDrawerOpen(false); setSettingsSection("general"); setSettingsOpen(true); });
  const editProfile = useStableCallback(() => { setDrawerOpen(false); setSettingsSection("profile"); setSettingsOpen(true); });
  const closeSettings = useStableCallback(() => setSettingsOpen(false));
  const changeModel = useStableCallback(async (choice: ModelChoice) => {
    if (busy.current || recovery || movePending.current) return;
    if (choice !== "Auto" && !availableModes.includes(choice)) return;
    const previous = modelChoice;
    setModelChoice(choice);
    if (choice === "Auto" || preview || !activeConversation) return;
    busy.current = true;
    setSending(true);
    setSavingMode(true);
    try {
      const result = await updateConversationModelAction(activeConversation.id, choice);
      if (result.error) { setModelChoice(previous); setNotice(result.error); return; }
      const updated = { ...activeConversation, selected_model: choice };
      setLocalConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
      router.refresh();
    } catch {
      setModelChoice(previous);
      setNotice("We couldn't save that model choice. Please try again.");
    } finally { busy.current = false; setSending(false); setSavingMode(false); }
  });
  const cancelEdit = useStableCallback(() => setEditingId(null));
  const startEdit = useStableCallback((id: string) => setEditingId(id));

  const history = activeId ? activeId : null;
  const caption = preview ? "Mock workspace · Messages stay in this tab and are not saved." : drafting && activeRoom ? `New thread in ${activeRoom.name}.` : null;
  const threadRoomId = activeId ? activeConversation?.room_id ?? null : drafting ? selectedRoomId : null;
  const threadRoom = rooms.find((room) => room.id === threadRoomId) ?? null;
  const roomItems = [{ value: "", label: "General" }, ...rooms.map((room) => ({ value: room.id, label: room.name }))];
  if (threadRoomId && !threadRoom) roomItems.push({ value: threadRoomId, label: "Room unavailable" });
  const roomsLoading = !preview && initialData?.rooms === undefined;
  const roomSelectionNotice = threadRoomId && !threadRoom ? "That room is unavailable. Choose General or another room." : roomsLoading ? "Loading rooms… General is available." : initialData?.roomsError ?? null;
  const roomLabel = threadRoom ? `Room · ${threadRoom.name}` : threadRoomId ? "Room unavailable" : "General";
  const threadRoomKey = threadRoom?.id ?? null;
  const [fileRoomKey, setFileRoomKey] = useState(threadRoomKey);
  if (fileRoomKey !== threadRoomKey) {
    setFileRoomKey(threadRoomKey);
    setSelectedFileIds([]);
    setFilePickerOpen(false);
  }
  const toggleRoomFiles = useStableCallback(() => setFilePickerOpen((open) => !open));
  const attach = useStableCallback(() => {
    if (preview || !threadRoom) {
      setNotice(preview ? "This preview isn't connected." : "Add a file on the room page, then choose it from a thread in that room.");
      return;
    }
    setFilePickerOpen((open) => !open);
  });
  const contextRoom = threadRoom ? roomContextFromRows({ name: threadRoom.name, instructions: threadRoom.instructions }, threadRoom.brief, threadRoom.pins) : null;
  const contextPreview = previewContextDiagnostics({
    preferences: savedPreferences,
    preferenceReadFailed: Boolean(preferencesError),
    hasEarlierMessages: messages.some((message) => message.role === "user" || message.role === "assistant"),
    room: contextRoom,
    selectedFileCount: selectedFileIds.length,
  });
  const accountName = accountDisplayName({ email, metadataName, preferredName: savedPreferences.preferredName });
  const greetingSource = savedPreferences.preferredName?.trim() || metadataName?.trim() || null;
  const greetingName = greetingSource?.split(/\s+/)[0] ?? null;
  const welcomeGreeting = welcomeGreetings[welcomeGreetingIndex](greetingName);
  const headerRoomName = (showRoom ? activeRoom?.name : threadRoom?.name) ?? null;
  const roomThreads = activeRoom ? shownConversations.filter((item) => item.room_id === activeRoom.id) : [];
  const searchCorpus = useMemo(() => {
    if (!preview) return undefined;
    // Exclude preview archived threads the user already restored in this session.
    const restoredIds = new Set(localConversations.map((item) => item.id));
    return [
      ...previewConversations,
      ...previewArchivedConversations.filter((item) => !restoredIds.has(item.id)),
      ...localConversations,
    ];
  }, [preview, previewConversations, previewArchivedConversations, localConversations]);
  const sidebarProps = { conversations: shownConversations, archivedConversations: preview ? previewArchivedConversations.filter((item) => !localConversations.some((entry) => entry.id === item.id)) : archivedConversations, rooms, activeId: history, activeRoomId: showRoom ? selectedRoomId : threadRoom?.id ?? null, busy: controlsDisabled || recovering, activity: assistantActivity, preview, email, name: accountName, releasePreview, renderedAt, settingsActive: settingsOpen, searchCorpus, onClose: closeDrawer, onOpen: openConversation, onOpenMessage: openConversationAtMessage, onOpenRoom: openRoom, onNewThreadInRoom: newThreadInRoom, onDeleteRoom: deleteRoomFromSidebar, onCreateRoom: openRoomSetup, onNewChat: newChat, onOpenSettings: openSettings, onRename: rename, onArchive: archive, onRestore: restore, onMove: moveThread, onCopyTranscript: copyTranscript };
  const composerProps = { ref: composerRef, dockRef: composerDockRef, sending: sending || recovering || movingThread !== null, streaming, mode, models, onModelChange: changeModel, researchMode, onResearchModeChange: setResearchMode, savingMode, caption, diagnostics: contextDiagnostics ?? contextPreview, onEditProfile: editProfile, onSubmit: submitMessage, onStop: stopStream, onAttach: attach, attachmentsEnabled: !preview, onRoomFiles: threadRoom && !preview ? toggleRoomFiles : undefined, roomItems, roomId: threadRoomId ?? "", roomLabel, roomSelectionNotice, roomsLoading, onRoomChange: activeId ? rooms.length ? changeComposerRoom : undefined : chooseDraftRoom, attachmentPanel: filePickerOpen && threadRoom ? <RoomFilePicker roomId={threadRoom.id} selectedIds={selectedFileIds} disabled={controlsDisabled || sending || streaming} onChange={setSelectedFileIds} /> : null };

  return <main className={`chat-workspace${workbenchDocumentId ? " has-workbench" : ""}`}>
    <ChatSidebar {...sidebarProps} collapsed={desktopSidebarCollapsed} desktopToggleRef={desktopCollapseButtonRef} desktopExpandRef={desktopExpandButtonRef} onCollapse={collapseDesktopSidebar} onExpand={expandDesktopSidebar} />
    {drawerOpen && <div className="mobile-drawer"><button className="drawer-scrim" aria-label="Dismiss menu backdrop" onClick={closeDrawer} /><ChatSidebar {...sidebarProps} mobile drawerRef={drawerRef} closeMenuRef={closeMenuRef} /></div>}
    <section className="chat-main" aria-label="Chat workspace">
      <header className="chat-header">
        <button ref={menuButtonRef} type="button" className="icon-button mobile-menu-button" aria-label={drawerOpen ? "Close conversation menu" : "Open conversation menu"} title="Toggle sidebar" aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((open) => !open)}>{drawerOpen ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}</button>
        <div className="header-model">{headerRoomName ? <span className="header-context is-room-name">{headerRoomName}</span> : null}</div>
        <button type="button" className="header-new-chat" aria-label="New chat" title="New chat" disabled={controlsDisabled} onClick={newChat}><SquarePen size={17} /></button>
      </header>
      <div ref={scrollRef} onScroll={handleScroll} className={`conversation-scroll ${showRoom ? "is-room" : messages.length || loadingConversation ? "has-messages" : "is-empty"}`}>
        {showRoom && activeRoom ? <RoomDetail key={activeRoom.id} room={activeRoom} threads={roomThreads} busy={controlsDisabled} preview={preview} onOpenThread={openConversation} onNewThread={() => newThreadInRoom(activeRoom.id)} onSaveRoom={saveRoom} onSaveBrief={saveBrief} onCreatePin={createPin} onUpdatePin={updatePin} onDeletePin={removePin} onDelete={removeRoom} /> : loadingConversation ? <div className="message-list conversation-skeleton" role="status" aria-busy="true" aria-label="Loading conversation"><div className="skeleton-line is-short" /><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line is-medium" /></div> : messages.length ? <div className="message-list" aria-live="polite">{messages.map((message) => <MessageRow key={message.id} message={message} initial={initial} isLast={message.id === lastMessage?.id} isLastUser={message.id === lastUser?.id} waitLabel={message.id === lastMessage?.id ? waitLabel : undefined} canMutate={!preview} disabled={messageActionsLocked} editing={editingId === message.id} responseFailed={notice === failureNotice} highlighted={focusMessageId === message.id} onRegenerate={regenerate} onStartEdit={startEdit} onCancelEdit={cancelEdit} onSaveEdit={saveEdit} onEditInWorkbench={WORKBENCH_UI_ENABLED && !preview ? editInWorkbench : undefined} workbenchPending={workbenchPending} />)}{notice && <p className="local-notice" role="status">{notice}</p>}</div> : <div className="welcome-state"><div className="welcome-panel">{notice && <p className="local-notice" role="status">{notice}</p>}<div className="welcome-copy-group"><h1 data-testid={drafting ? undefined : "welcome-greeting"}>{drafting && activeRoom ? activeRoom.name : welcomeGreeting}</h1>{drafting && activeRoom ? <><p className="welcome-eyebrow">NEW THREAD</p><p className="welcome-copy">This thread starts inside the room. Nibie will use its instructions, brief, and pins.</p></> : null}</div></div>{centeredComposer ? <ChatComposer {...composerProps} centered /> : null}</div>}
      </div>
      {!showRoom && !centeredComposer ? <ChatComposer {...composerProps} /> : null}    </section>
    {renaming && <dialog ref={renameDialogRef} className="room-setup-dialog" aria-labelledby={renameTitleId} aria-busy={renameSaving} onCancel={(event) => { event.preventDefault(); if (!renameSaving) setRenaming(null); }}>
      <header className="settings-header"><h1 id={renameTitleId}>Rename conversation</h1><button type="button" className="icon-button" aria-label="Close rename dialog" disabled={renameSaving} onClick={() => setRenaming(null)}><X size={18} /></button></header>
      <form className="room-setup-form" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
        <label className="room-field"><span>Conversation title</span><input value={renameTitle} maxLength={120} required disabled={renameSaving} onChange={(event) => setRenameTitle(event.target.value)} /></label>
        {renameError ? <p className="privacy-error" role="alert">{renameError}</p> : null}
        <div className="room-setup-actions"><button type="button" className="privacy-button" disabled={renameSaving} onClick={() => setRenaming(null)}>Cancel</button><button type="submit" className="privacy-button" disabled={renameSaving || !renameTitle.trim()}>{renameSaving ? "Saving…" : "Save"}</button></div>
      </form>
    </dialog>}
    {creatingRoom ? <RoomCreateDialog preview={preview} onClose={closeRoomSetup} onCreate={createRoom} /> : null}
    {settingsOpen ? <SettingsDialog initialSection={settingsSection} email={email} preview={preview} busy={controlsDisabled} models={models} initialPreferences={savedPreferences} initialError={preferencesError} onClose={closeSettings} onSaved={setSavedPreferences} onConversationsDeleted={conversationsDeleted} /> : null}
    {WORKBENCH_UI_ENABLED && workbenchDocumentId ? <WorkbenchPanel key={workbenchDocumentId} documentId={workbenchDocumentId} onClose={closeWorkbenchPanel} /> : null}
  </main>;
}
