"use client";

import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Archive, ChevronDown, ChevronRight, DoorOpen, LoaderCircle, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Search, Settings, SquarePen, Trash2, X } from "lucide-react";
import { SIGN_OUT_LABEL } from "@/lib/privacy/sign-out";
import { AccountMenu } from "@/components/account-menu";
import type { WhatsNewPreview } from "@/lib/changelog";
import { Brand, BrandMark, type BrandActivity } from "@/components/brand";
import { chatPath } from "@/lib/routes";
import { groupFor, groupThreads, historyGroups, requestTime } from "@/lib/chat/groups";
import type { ConversationSummary, RoomSummary } from "@/lib/chat/read";
import {
  highlightMatchParts,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX_QUERY,
  SEARCH_MIN_CHARS,
  searchLocalConversations,
  type ChatSearchHit,
  type ChatSearchMessageHit,
  type ChatSearchPayload,
  type LocalSearchConversation,
} from "@/lib/chat/search";

const noopSubscribe = () => () => undefined;

type Props = {
  conversations: ConversationSummary[];
  archivedConversations: ConversationSummary[];
  rooms: RoomSummary[];
  activeId: string | null;
  activeRoomId: string | null;
  busy: boolean;
  activity: BrandActivity;
  preview: boolean;
  email: string;
  name: string;
  releasePreview?: WhatsNewPreview | null;
  /** Preview-only corpus with message bodies for local content search. */
  searchCorpus?: LocalSearchConversation[];
  // The server's clock when the page was rendered; used (with the UTC calendar) until hydration has finished.
  renderedAt?: number;
  mobile?: boolean;
  drawerRef?: RefObject<HTMLElement | null>;
  closeMenuRef?: RefObject<HTMLButtonElement | null>;
  desktopToggleRef?: RefObject<HTMLButtonElement | null>;
  desktopExpandRef?: RefObject<HTMLButtonElement | null>;
  collapsed?: boolean;
  settingsActive?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  onClose: () => void;
  onOpen: (id: string | null) => void;
  onOpenMessage?: (conversationId: string, messageId: string) => void;
  onOpenRoom: (id: string) => void;
  onNewThreadInRoom: (id: string) => void;
  onDeleteRoom: (id: string) => Promise<{ error?: string }>;
  onCreateRoom: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onRename: (item: ConversationSummary) => void;
  onArchive: (item: ConversationSummary) => void;
  onRestore: (item: ConversationSummary) => void;
  onMove: (item: ConversationSummary, roomId: string | null) => Promise<void>;
};

function SearchHighlight({ text, query }: { text: string; query: string }) {
  return <>{highlightMatchParts(text, query).map((part, index) => part.match
    ? <mark key={index} className="chat-search-mark">{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</>;
}

function contextLabel(hit: ChatSearchHit) {
  const room = hit.roomName?.trim() || "General";
  if (hit.kind === "message") {
    const role = hit.role === "assistant" ? "Assistant" : "User";
    return `${room} · ${role}`;
  }
  return room;
}

function ConversationSearchDialog({
  conversations,
  archivedConversations,
  rooms,
  preview,
  searchCorpus,
  onOpen,
  onOpenMessage,
  onRestore,
  onClose,
}: Pick<Props, "conversations" | "archivedConversations" | "rooms" | "preview" | "searchCorpus" | "onOpen" | "onOpenMessage" | "onRestore" | "onClose">) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [remote, setRemote] = useState<ChatSearchPayload | null>(null);
  const [searching, setSearching] = useState(false);
  const [messageSearchFailed, setMessageSearchFailed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestId = useRef(0);
  const trimmed = search.trim();
  const query = trimmed.toLowerCase();
  const contentReady = trimmed.length >= SEARCH_MIN_CHARS;

  const localTitleMatches = useMemo(
    () => (query ? conversations.filter((item) => item.title.toLowerCase().includes(query)) : conversations),
    [conversations, query],
  );
  const localArchivedTitleMatches = useMemo(
    () => (query ? archivedConversations.filter((item) => item.title.toLowerCase().includes(query)) : []),
    [archivedConversations, query],
  );

  const localPayload = useMemo(() => {
    if (!contentReady || !searchCorpus) return null;
    return searchLocalConversations(searchCorpus, rooms, trimmed);
  }, [contentReady, searchCorpus, rooms, trimmed]);

  const payload = preview ? localPayload : remote;
  const fallbackTitleHits = localTitleMatches.map((item) => ({
    kind: "conversation" as const,
    conversationId: item.id,
    title: item.title,
    roomId: item.room_id,
    roomName: rooms.find((room) => room.id === item.room_id)?.name ?? null,
    archived: false,
  }));
  const fallbackArchivedHits = localArchivedTitleMatches.map((item) => ({
    kind: "conversation" as const,
    conversationId: item.id,
    title: item.title,
    roomId: item.room_id,
    roomName: rooms.find((room) => room.id === item.room_id)?.name ?? null,
    archived: true,
  }));
  const conversationHits = contentReady ? (payload?.conversations ?? fallbackTitleHits) : [];
  const messageHits = contentReady ? (payload?.messages ?? []) : [];
  const archivedHits = contentReady
    ? (payload?.archived ?? fallbackArchivedHits)
    : fallbackArchivedHits;

  // Below the content-search threshold, keep the previous recent/title-only list.
  const recentOrTitle = contentReady ? conversationHits : fallbackTitleHits;

  const flatResults = useMemo(() => {
    const rows: Array<{ key: string; hit: ChatSearchHit; group: "conversation" | "message" | "archived" }> = [];
    for (const hit of recentOrTitle) rows.push({ key: `c-${hit.conversationId}`, hit, group: "conversation" });
    for (const hit of messageHits) rows.push({ key: `m-${hit.messageId}`, hit, group: "message" });
    for (const hit of archivedHits) rows.push({ key: `a-${hit.kind}-${hit.kind === "message" ? hit.messageId : hit.conversationId}`, hit, group: "archived" });
    return rows;
  }, [recentOrTitle, messageHits, archivedHits]);

  useEffect(() => { setSelectedIndex(0); }, [trimmed]);
  useEffect(() => {
    if (selectedIndex >= flatResults.length) setSelectedIndex(Math.max(0, flatResults.length - 1));
  }, [flatResults.length, selectedIndex]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    // Prevent unexpected page scroll when focusing the search field.
    inputRef.current?.focus({ preventScroll: true });
    return () => { dialog?.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    if (preview || !contentReady) {
      setRemote(null);
      setSearching(false);
      setMessageSearchFailed(false);
      return;
    }
    const controller = new AbortController();
    const id = ++requestId.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/chat/search?q=${encodeURIComponent(trimmed.slice(0, SEARCH_MAX_QUERY))}`, {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (id !== requestId.current) return;
        if (!response.ok) {
          setMessageSearchFailed(true);
          setRemote({
            query: trimmed,
            conversations: localTitleMatches.map((item) => ({
              kind: "conversation",
              conversationId: item.id,
              title: item.title,
              roomId: item.room_id,
              roomName: rooms.find((room) => room.id === item.room_id)?.name ?? null,
              archived: false,
            })),
            messages: [],
            archived: localArchivedTitleMatches.map((item) => ({
              kind: "conversation",
              conversationId: item.id,
              title: item.title,
              roomId: item.room_id,
              roomName: rooms.find((room) => room.id === item.room_id)?.name ?? null,
              archived: true,
            })),
            messageSearchFailed: true,
          });
          return;
        }
        const data = await response.json() as ChatSearchPayload;
        if (id !== requestId.current) return;
        setRemote(data);
        setMessageSearchFailed(Boolean(data.messageSearchFailed));
      } catch (error) {
        if (controller.signal.aborted || id !== requestId.current) return;
        setMessageSearchFailed(true);
        setRemote({
          query: trimmed,
          conversations: localTitleMatches.map((item) => ({
            kind: "conversation",
            conversationId: item.id,
            title: item.title,
            roomId: item.room_id,
            roomName: rooms.find((room) => room.id === item.room_id)?.name ?? null,
            archived: false,
          })),
          messages: [],
          archived: localArchivedTitleMatches.map((item) => ({
            kind: "conversation",
            conversationId: item.id,
            title: item.title,
            roomId: item.room_id,
            roomName: rooms.find((room) => room.id === item.room_id)?.name ?? null,
            archived: true,
          })),
          messageSearchFailed: true,
        });
        void error;
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [preview, contentReady, trimmed, localTitleMatches, localArchivedTitleMatches, rooms]);

  function activate(hit: ChatSearchHit) {
    if (hit.archived) return;
    onClose();
    if (hit.kind === "message" && onOpenMessage) onOpenMessage(hit.conversationId, hit.messageId);
    else onOpen(hit.conversationId);
  }

  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (!flatResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % flatResults.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index <= 0 ? flatResults.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter") {
      const row = flatResults[selectedIndex];
      if (!row || row.hit.archived) return;
      event.preventDefault();
      activate(row.hit);
    }
  }

  const total = flatResults.length;
  const empty = contentReady && !searching && total === 0;
  const status = !trimmed
    ? "Search conversation titles and saved message content."
    : searching
      ? "Searching…"
      : messageSearchFailed
        ? "Message search is temporarily unavailable. Showing conversation titles only."
        : empty
          ? "No matching conversations or messages."
          : `${total} ${total === 1 ? "result" : "results"}`;

  let resultOffset = 0;
  const conversationStart = resultOffset;
  resultOffset += recentOrTitle.length;
  const messageStart = resultOffset;
  resultOffset += messageHits.length;
  const archivedStart = resultOffset;

  return <dialog ref={dialogRef} className="chat-search-dialog" aria-labelledby={titleId} onKeyDown={onDialogKeyDown} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="chat-search-panel">
      <header className="settings-header chat-search-header"><h1 id={titleId}>Search chats</h1><button type="button" className="icon-button" aria-label="Close search" onClick={onClose}><X size={18} /></button></header>
      <label className="history-search chat-search-input">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search conversations and messages"
          placeholder="Search conversations and messages…"
          maxLength={SEARCH_MAX_QUERY}
          value={search}
          onChange={(event) => setSearch(event.target.value.slice(0, SEARCH_MAX_QUERY))}
        />
        {search ? <button type="button" className="chat-search-clear" aria-label="Clear search" onClick={() => { setSearch(""); inputRef.current?.focus({ preventScroll: true }); }}><X size={14} aria-hidden="true" /></button> : null}
      </label>
      <div className="chat-search-results">
        <p className="history-search-status" role="status" aria-live="polite">
          {searching ? <LoaderCircle size={14} className="chat-search-spinner" aria-hidden="true" /> : null}
          <span>{status}</span>
          {empty ? <span className="chat-search-status-secondary">Try a different word or phrase.</span> : null}
        </p>
        {recentOrTitle.length > 0 && <section className="history-group" aria-label={contentReady ? "Conversation title matches" : "Recent chats"}>
          <h2>{contentReady ? "Conversations" : "Recent chats"}</h2>
          {recentOrTitle.map((hit, index) => {
            const selected = selectedIndex === conversationStart + index;
            return <button type="button" className={`chat-search-row is-title${selected ? " is-selected" : ""}`} key={hit.conversationId} aria-label={hit.title} aria-selected={selected} onMouseEnter={() => setSelectedIndex(conversationStart + index)} onClick={() => activate(hit)}>
              <MessageSquare size={15} aria-hidden="true" />
              <span className="chat-search-row-body">
                <span className="chat-search-row-title" aria-hidden="true">{contentReady ? <SearchHighlight text={hit.title} query={trimmed} /> : hit.title}</span>
                {contentReady ? <span className="chat-search-row-meta" aria-hidden="true">Title match · {contextLabel(hit)}</span> : null}
              </span>
            </button>;
          })}
        </section>}
        {messageHits.length > 0 && <section className="history-group" aria-label="Message matches">
          <h2>Messages</h2>
          {messageHits.map((hit, index) => {
            const selected = selectedIndex === messageStart + index;
            return <button type="button" className={`chat-search-row is-message${selected ? " is-selected" : ""}`} key={hit.messageId} aria-label={`${hit.title}: ${hit.snippet}`} aria-selected={selected} onMouseEnter={() => setSelectedIndex(messageStart + index)} onClick={() => activate(hit)}>
              <MessageSquare size={15} aria-hidden="true" />
              <span className="chat-search-row-body" aria-hidden="true">
                <span className="chat-search-row-title">{hit.title}</span>
                <span className="chat-search-row-snippet"><SearchHighlight text={hit.snippet} query={trimmed} /></span>
                <span className="chat-search-row-meta">{contextLabel(hit)}</span>
              </span>
            </button>;
          })}
        </section>}
        {archivedHits.length > 0 && <section className="history-group" aria-label="Archived search results">
          <h2>Archived</h2>
          {archivedHits.map((hit, index) => {
            const selected = selectedIndex === archivedStart + index;
            const summary: ConversationSummary = {
              id: hit.conversationId,
              title: hit.title,
              selected_model: "Balanced",
              room_id: hit.roomId,
              archived_at: new Date().toISOString(),
              created_at: "",
              updated_at: "",
            };
            return <div className={`history-entry chat-search-archived${selected ? " is-selected" : ""}`} key={hit.kind === "message" ? hit.messageId : hit.conversationId} onMouseEnter={() => setSelectedIndex(archivedStart + index)}>
              <span className="chat-search-row is-archived" title={hit.title}>
                <Archive size={15} aria-hidden="true" />
                <span className="chat-search-row-body">
                  <span className="chat-search-row-title">{contentReady ? <SearchHighlight text={hit.title} query={trimmed} /> : hit.title}</span>
                  {hit.kind === "message" ? <span className="chat-search-row-snippet"><SearchHighlight text={(hit as ChatSearchMessageHit).snippet} query={trimmed} /></span> : null}
                  <span className="chat-search-row-meta">{contextLabel(hit)}</span>
                </span>
              </span>
              <button type="button" className="history-action" aria-label={`Restore ${hit.title}`} title="Restore" onClick={() => onRestore(summary)}><RotateCcw size={15} aria-hidden="true" /></button>
            </div>;
          })}
        </section>}
      </div>
    </div>
  </dialog>;
}

// Memoized: streaming tokens and typing never re-render the history list.
export const ChatSidebar = memo(function ChatSidebar({ conversations, archivedConversations, rooms, activeId, activeRoomId, busy, activity, preview, email, name, releasePreview = null, searchCorpus, renderedAt, mobile = false, drawerRef, closeMenuRef, desktopToggleRef, desktopExpandRef, collapsed = false, settingsActive = false, onCollapse, onExpand, onClose, onOpen, onOpenMessage, onOpenRoom, onNewThreadInRoom, onDeleteRoom, onCreateRoom, onNewChat, onOpenSettings, onRename, onArchive, onRestore, onMove }: Props) {
  // Server render and hydration group by the UTC calendar from the server's clock so both agree; once mounted, the viewer's own clock and
  // time zone are used (the grouping is recomputed whenever the list changes).
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const now = useMemo(() => (mounted ? requestTime() : renderedAt ?? 0), [mounted, renderedAt]);
  const grouped = useMemo(() => groupThreads(conversations), [conversations]);
  const generalGroups = useMemo(() => historyGroups.map((group) => ({ group, entries: grouped.general.filter((item) => groupFor(item.updated_at, now, mounted ? undefined : "UTC") === group) })), [grouped, now, mounted]);
  const historyGroupId = useId();
  const [collapsedHistoryGroups, setCollapsedHistoryGroups] = useState<string[]>([]);
  const [expandedRooms, setExpandedRooms] = useState<string[]>(activeRoomId ? [activeRoomId] : []);
  const activeRoomKey = activeRoomId ? `${activeRoomId}:${activeId ?? ""}` : null;
  const [expandedActiveRoom, setExpandedActiveRoom] = useState(activeRoomKey);
  if (expandedActiveRoom !== activeRoomKey) {
    setExpandedActiveRoom(activeRoomKey);
    if (activeRoomId) setExpandedRooms((ids) => ids.includes(activeRoomId) ? ids : [...ids, activeRoomId]);
  }
  const [dropRoom, setDropRoom] = useState<string | null | undefined>(undefined);
  const [moveItem, setMoveItem] = useState<ConversationSummary | null>(null);
  const [moveRoomId, setMoveRoomId] = useState("");
  const moveDialogRef = useRef<HTMLDialogElement>(null);
  const moveTitleId = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ item: ConversationSummary; x: number; y: number } | null>(null);
  const [roomActionMenuId, setRoomActionMenuId] = useState<string | null>(null);
  const [roomActionMenuPosition, setRoomActionMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextTriggerRef = useRef<HTMLDivElement>(null);
  const roomActionMenuRef = useRef<HTMLDivElement>(null);
  const roomActionTriggerRef = useRef<HTMLButtonElement>(null);
  const historyNavRef = useRef<HTMLElement>(null);
  const roomsSectionRef = useRef<HTMLElement>(null);
  const generalSectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!moveItem) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = moveDialogRef.current;
    dialog?.showModal();
    dialog?.querySelector("select")?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, [moveItem]);
  useEffect(() => {
    if (!contextMenu) return;
    contextMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismissOutside = (event: PointerEvent) => { if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null); };
    const dismissEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setContextMenu(null); contextTriggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => { document.removeEventListener("pointerdown", dismissOutside); document.removeEventListener("keydown", dismissEscape); };
  }, [contextMenu]);
  useEffect(() => {
    if (!roomActionMenuId) return;
    roomActionMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (!roomActionMenuRef.current?.contains(event.target as Node) && !roomActionTriggerRef.current?.contains(event.target as Node)) {
        setRoomActionMenuId(null);
        setRoomActionMenuPosition(null);
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [roomActionMenuId]);
  function handleRoomMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === "ArrowDown" ? (index + 1) % items.length
      : event.key === "ArrowUp" ? (index <= 0 ? items.length - 1 : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : -1;
    if (target >= 0) { event.preventDefault(); items[target]?.focus(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRoomActionMenuId(null); setRoomActionMenuPosition(null); roomActionTriggerRef.current?.focus(); }
    else if (event.key === "Tab") { setRoomActionMenuId(null); setRoomActionMenuPosition(null); }
  }
  function showActions(item: ConversationSummary, trigger: HTMLDivElement, x: number, y: number) {
    contextTriggerRef.current = trigger;
    setContextMenu({ item, x: Math.max(8, Math.min(x, window.innerWidth - 192)), y: Math.max(8, Math.min(y, window.innerHeight - 140)) });
  }
  function drop(event: DragEvent<HTMLElement>, roomId: string | null) {
    event.preventDefault();
    setDropRoom(undefined);
    if (mobile || busy) return;
    const id = event.dataTransfer.getData("application/x-nibie-thread");
    const item = conversations.find((entry) => entry.id === id && !entry.archived_at);
    if (!item) return;
    if (roomId) setExpandedRooms((ids) => ids.includes(roomId) ? ids : [...ids, roomId]);
    void onMove(item, roomId);
  }
  function dragOver(event: DragEvent<HTMLElement>, roomId: string | null) {
    if (mobile || busy || !event.dataTransfer.types.includes("application/x-nibie-thread")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropRoom(roomId);
  }
  function renderThread(item: ConversationSummary) {
    return <div className="history-entry" key={item.id} data-conversation-id={item.id} tabIndex={-1} draggable={!mobile && !busy}
      onDragStart={(event) => { if (mobile || busy) { event.preventDefault(); return; } event.dataTransfer.setData("application/x-nibie-thread", item.id); event.dataTransfer.effectAllowed = "move"; setContextMenu(null); }} onDragEnd={() => setDropRoom(undefined)}
      onContextMenu={(event) => { event.preventDefault(); showActions(item, event.currentTarget, event.clientX, event.clientY); }}>
      <button className={`history-item ${activeId === item.id ? "is-active" : ""}`} onClick={(event) => { if (event.detail === 2) onRename(item); else onOpen(item.id); }} title={`${item.title} · Double-click to rename`}><MessageSquare size={15} /><span>{item.title}</span></button>
      <button type="button" className="history-action" aria-label={`Actions for ${item.title}`} title="Thread actions" aria-haspopup="menu" onClick={(event) => { const trigger = event.currentTarget.closest<HTMLDivElement>(".history-entry"); if (!trigger) return; const box = event.currentTarget.getBoundingClientRect(); showActions(item, trigger, box.left, box.bottom); }}><MoreHorizontal size={15} /></button>
      {!preview && <button className="history-action" aria-label={`Archive ${item.title}`} title="Archive" disabled={busy} onClick={() => onArchive(item)}><Archive size={13} /></button>}
    </div>;
  }
  return <aside ref={mobile ? drawerRef : undefined} className={"workspace-sidebar" + (mobile ? " mobile-sidebar" : " desktop-sidebar" + (collapsed ? " is-collapsed" : ""))} aria-label={mobile ? "Conversation menu" : "Conversation history"} role={mobile ? "dialog" : undefined} aria-modal={mobile ? true : undefined}>
    <div className="sidebar-top">{collapsed && !mobile ? <button ref={desktopExpandRef} type="button" className="rail-brand-toggle" aria-label="Expand sidebar" title="Expand sidebar" aria-expanded="false" onClick={onExpand}><BrandMark activity={activity} /><PanelLeftOpen className="rail-brand-toggle-icon" size={18} aria-hidden="true" /></button> : <Brand href={chatPath} label="Nibie home" activity={activity} />}{mobile ? <button ref={closeMenuRef} type="button" className="icon-button" aria-label="Close menu" title="Collapse sidebar" aria-expanded="true" onClick={onClose}><PanelLeftClose size={18} aria-hidden="true" /></button> : collapsed ? null : <div className="sidebar-controls"><button type="button" className="icon-button" aria-label="Search conversations" title="Search conversations" aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}><Search size={18} aria-hidden="true" /></button>{onCollapse ? <button ref={desktopToggleRef} type="button" className="icon-button" aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded="true" onClick={onCollapse}><PanelLeftClose size={18} /></button> : null}</div>}</div>
    {collapsed && !mobile ? <nav className="sidebar-rail-nav" aria-label="Primary navigation">
      <button type="button" className="rail-button" aria-label="New chat" title="New chat" disabled={busy} onClick={onNewChat}><SquarePen size={17} aria-hidden="true" /></button>
      <button type="button" className={"rail-button" + (activeRoomId ? " is-active" : "")} aria-label="Rooms" title="Rooms" aria-current={activeRoomId ? "page" : undefined} onClick={() => { onExpand?.(); requestAnimationFrame(() => roomsSectionRef.current?.focus()); }}><DoorOpen size={17} aria-hidden="true" /></button>
      <button type="button" className={"rail-button" + (!activeRoomId && !settingsActive ? " is-active" : "")} aria-label="General" title="General" aria-current={!activeRoomId && !settingsActive ? "page" : undefined} onClick={() => { onExpand?.(); if (grouped.general.length) onOpen(grouped.general[0].id); else onNewChat(); requestAnimationFrame(() => generalSectionRef.current?.focus()); }}><MessageSquare size={17} aria-hidden="true" /></button>
    </nav> : <button type="button" className="new-chat-button" disabled={busy} onClick={onNewChat}><SquarePen size={17} /> <span>New chat</span></button>}
    {!collapsed || mobile ? <nav ref={historyNavRef} className="history-nav" aria-label="Conversations" tabIndex={-1}>
      <section ref={roomsSectionRef} className="history-group" aria-label="Rooms" tabIndex={-1}>
        <h2>Rooms</h2>
        {rooms.map((room) => {
          const expanded = expandedRooms.includes(room.id);
          return <div key={room.id} className={`sidebar-room${dropRoom === room.id ? " is-drop-target" : ""}`} data-room-id={room.id} onDragOver={(event) => dragOver(event, room.id)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropRoom(undefined); }} onDrop={(event) => drop(event, room.id)}>
            <div className="history-entry room-entry" onContextMenu={(event) => { event.preventDefault(); roomActionTriggerRef.current = event.currentTarget.querySelector<HTMLButtonElement>(".room-action-trigger"); setRoomActionMenuPosition({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 176)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 120)) }); setRoomActionMenuId(room.id); }}><button type="button" className="room-expand" aria-label={`${expanded ? "Collapse" : "Expand"} ${room.name}`} aria-expanded={expanded} onClick={() => setExpandedRooms((ids) => expanded ? ids.filter((id) => id !== room.id) : [...ids, room.id])}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><button className={`history-item ${activeRoomId === room.id && !activeId ? "is-active" : ""}`} onClick={() => onOpenRoom(room.id)} title={room.name}><DoorOpen size={15} /><span>{room.name}</span></button><button type="button" className="history-action room-new-thread" aria-label={`New thread in ${room.name}`} title={`New thread in ${room.name}`} disabled={busy} onClick={() => onNewThreadInRoom(room.id)}><Plus size={15} aria-hidden="true" /></button><button ref={roomActionTriggerRef} type="button" className="history-action room-action-trigger" aria-label={`Actions for ${room.name}`} title="Room actions" aria-haspopup="menu" aria-expanded={roomActionMenuId === room.id} onClick={(event) => { roomActionTriggerRef.current = event.currentTarget; setRoomActionMenuPosition(null); setRoomActionMenuId((current) => current === room.id ? null : room.id); }}><MoreHorizontal size={15} aria-hidden="true" /></button>
              {roomActionMenuId === room.id && <div ref={roomActionMenuRef} className={`room-action-menu${roomActionMenuPosition ? " is-context-menu" : ""}`} style={roomActionMenuPosition ? { left: roomActionMenuPosition.x, top: roomActionMenuPosition.y } : undefined} role="menu" aria-label={`Actions for ${room.name}`} onKeyDown={handleRoomMenuKeyDown}>
                <button type="button" role="menuitem" disabled={busy} onClick={() => { setRoomActionMenuId(null); setRoomActionMenuPosition(null); onNewThreadInRoom(room.id); }}><Plus size={14} aria-hidden="true" />New thread</button>
                <button type="button" role="menuitem" onClick={() => { setRoomActionMenuId(null); setRoomActionMenuPosition(null); onOpenRoom(room.id); }}><Pencil size={14} aria-hidden="true" />Edit room</button>
                <button type="button" role="menuitem" className="is-danger" disabled={busy} onClick={() => { setRoomActionMenuId(null); setRoomActionMenuPosition(null); if (window.confirm(`Delete “${room.name}”? Threads in this room become general threads. Pins in this room are deleted.`)) void onDeleteRoom(room.id); else requestAnimationFrame(() => roomActionTriggerRef.current?.focus()); }}><Trash2 size={14} aria-hidden="true" />Delete room</button>
              </div>}
            </div>
            {expanded && <div className="room-thread-list" role="group" aria-label={`Threads in ${room.name}`}>{(grouped.byRoom.get(room.id) ?? []).map(renderThread)}</div>}
          </div>;
        })}
        <button className="history-item" disabled={busy} onClick={onCreateRoom}><Plus size={15} /><span>New room</span></button>
      </section>
      <section ref={generalSectionRef} tabIndex={-1} className={`history-group chat-history${dropRoom === null ? " is-drop-target" : ""}`} aria-label="Chat history" onDragOver={(event) => dragOver(event, null)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropRoom(undefined); }} onDrop={(event) => drop(event, null)}>
        {generalGroups.map(({ group, entries }) => {
          if (!entries.length) return null;
          const collapsedGroup = collapsedHistoryGroups.includes(group);
          const groupId = `${historyGroupId}-${group.toLowerCase()}`;
          return <section className="history-group" key={group} aria-label={group}>
            <h2><button type="button" className="history-time-toggle" aria-label={`${collapsedGroup ? "Show" : "Hide"} ${group} chats`} title={`${collapsedGroup ? "Show" : "Hide"} ${group} chats`} aria-expanded={!collapsedGroup} aria-controls={groupId} onClick={() => setCollapsedHistoryGroups((groups) => collapsedGroup ? groups.filter((item) => item !== group) : [...groups, group])}>{group}{collapsedGroup ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}</button></h2>
            <div id={groupId} hidden={collapsedGroup}>{entries.map(renderThread)}</div>
          </section>;
        })}
      </section>
    </nav> : null}
    {contextMenu && <div ref={contextMenuRef} className="history-context-menu" role="menu" aria-label={`Actions for ${contextMenu.item.title}`} tabIndex={-1} style={{ left: contextMenu.x, top: contextMenu.y }}><button type="button" role="menuitem" disabled={busy} onClick={() => { setMoveItem(contextMenu.item); setMoveRoomId(contextMenu.item.room_id ?? ""); setContextMenu(null); }}>Move to…</button>{!preview && <><button type="button" role="menuitem" onClick={() => { setContextMenu(null); onRename(contextMenu.item); }}><Pencil size={14} />Rename</button><button type="button" role="menuitem" disabled={busy} onClick={() => { setContextMenu(null); onArchive(contextMenu.item); }}><Archive size={14} />Archive</button></>}</div>}
    {moveItem && <dialog ref={moveDialogRef} className="thread-move-dialog" aria-labelledby={moveTitleId} onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); setMoveItem(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); const item = moveItem; setMoveItem(null); if (moveRoomId) setExpandedRooms((ids) => ids.includes(moveRoomId) ? ids : [...ids, moveRoomId]); void onMove(item, moveRoomId || null); }}>
        <h2 id={moveTitleId}>Move thread</h2><p>{moveItem.title}</p><label>Move to<select aria-label="Move to" value={moveRoomId} onChange={(event) => setMoveRoomId(event.target.value)}><option value="">General</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <div className="room-setup-actions"><button type="button" className="privacy-button" onClick={() => setMoveItem(null)}>Cancel</button><button type="submit" className="privacy-button" disabled={busy}>Move thread</button></div>
      </form>
    </dialog>}
    <div className="account-area"><div className="account-row"><AccountMenu email={email} name={name} releasePreview={releasePreview} signOutLabel={SIGN_OUT_LABEL} onOpenSettings={onOpenSettings} compact={collapsed && !mobile} /><button type="button" className={"icon-button account-settings" + (settingsActive ? " is-active" : "")} aria-label="Settings" title="Settings" aria-current={settingsActive ? "page" : undefined} onClick={onOpenSettings}><Settings size={16} aria-hidden="true" /></button></div></div>
    {searchOpen && <ConversationSearchDialog conversations={conversations} archivedConversations={archivedConversations} rooms={rooms} preview={preview} searchCorpus={searchCorpus} onOpen={onOpen} onOpenMessage={onOpenMessage} onRestore={onRestore} onClose={() => setSearchOpen(false)} />}
  </aside>;
});
