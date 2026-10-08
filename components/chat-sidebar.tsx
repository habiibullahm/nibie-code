"use client";

import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Archive, ChevronDown, ChevronRight, Copy, DoorOpen, Download, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Search, Settings, SquarePen, Trash2, X } from "lucide-react";
import { SIGN_OUT_LABEL } from "@/lib/privacy/sign-out";
import { AccountMenu } from "@/components/account-menu";
import type { WhatsNewPreview } from "@/lib/changelog";
import { Brand, BrandMark, type BrandActivity } from "@/components/brand";
import { chatPath } from "@/lib/routes";
import { groupFor, groupThreads, historyGroups, requestTime } from "@/lib/chat/groups";
import type { ConversationSummary, RoomSummary } from "@/lib/chat/read";

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
  onCopyTranscript: (item: ConversationSummary) => void | Promise<void>;
  onDownloadTranscript: (item: ConversationSummary) => void | Promise<void>;
};

function ConversationSearchDialog({ conversations, archivedConversations, onOpen, onRestore, onClose }: Pick<Props, "conversations" | "archivedConversations" | "onOpen" | "onRestore" | "onClose">) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matches = query ? conversations.filter((item) => item.title.toLowerCase().includes(query)) : conversations;
  const archivedMatches = query ? archivedConversations.filter((item) => item.title.toLowerCase().includes(query)) : [];
  const count = matches.length + archivedMatches.length;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialogRef} className="chat-search-dialog" aria-labelledby={titleId} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); onClose(); } }} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="chat-search-panel">
      <header className="settings-header"><h1 id={titleId}>Search chats</h1><button type="button" className="icon-button" aria-label="Close search" onClick={onClose}><X size={18} /></button></header>
      <label className="history-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search chat titles, including archived chats" placeholder="Search chat titles" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="chat-search-results">
        <p className="history-search-status" role="status">{query ? count ? `${count} ${count === 1 ? "chat" : "chats"} found` : "No chats found." : "Search chat titles, including archived chats."}</p>
        {matches.length > 0 && <section className="history-group" aria-label="Chat search results"><h2>{query ? "Chats" : "Recent chats"}</h2>{matches.map((item) => <button type="button" className="history-item" key={item.id} title={item.title} onClick={() => { onClose(); onOpen(item.id); }}><MessageSquare size={15} aria-hidden="true" /><span>{item.title}</span></button>)}</section>}
        {archivedMatches.length > 0 && <section className="history-group" aria-label="Archived search results"><h2>Archived</h2>{archivedMatches.map((item) => <div className="history-entry" key={item.id}><span className="history-item archived-item" title={item.title}><Archive size={15} aria-hidden="true" /><span>{item.title}</span></span><button type="button" className="history-action" aria-label={`Restore ${item.title}`} title="Restore" onClick={() => onRestore(item)}><RotateCcw size={15} aria-hidden="true" /></button></div>)}</section>}
      </div>
    </div>
  </dialog>;
}

// Memoized: streaming tokens and typing never re-render the history list.
export const ChatSidebar = memo(function ChatSidebar({ conversations, archivedConversations, rooms, activeId, activeRoomId, busy, activity, preview, email, name, releasePreview = null, renderedAt, mobile = false, drawerRef, closeMenuRef, desktopToggleRef, desktopExpandRef, collapsed = false, settingsActive = false, onCollapse, onExpand, onClose, onOpen, onOpenRoom, onNewThreadInRoom, onDeleteRoom, onCreateRoom, onNewChat, onOpenSettings, onRename, onArchive, onRestore, onMove, onCopyTranscript, onDownloadTranscript }: Props) {
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
  const contextTriggerRef = useRef<HTMLElement | null>(null);
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
  function showActions(item: ConversationSummary, trigger: HTMLElement, x: number, y: number) {
    contextTriggerRef.current = trigger;
    // Taller menu: Move, Copy transcript, Download, plus Rename/Archive when signed in.
    setContextMenu({ item, x: Math.max(8, Math.min(x, window.innerWidth - 192)), y: Math.max(8, Math.min(y, window.innerHeight - 220)) });
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
      onContextMenu={(event) => { event.preventDefault(); const actions = event.currentTarget.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${item.title}"]`); showActions(item, actions ?? event.currentTarget, event.clientX, event.clientY); }}>
      <button className={`history-item ${activeId === item.id ? "is-active" : ""}`} onClick={(event) => { if (event.detail === 2) onRename(item); else onOpen(item.id); }} title={`${item.title} · Double-click to rename`}><MessageSquare size={15} /><span>{item.title}</span></button>
      <button type="button" className="history-action" aria-label={`Actions for ${item.title}`} title="Thread actions" aria-haspopup="menu" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); showActions(item, event.currentTarget, box.left, box.bottom); }}><MoreHorizontal size={15} /></button>
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
    {contextMenu && <div ref={contextMenuRef} className="history-context-menu" role="menu" aria-label={`Actions for ${contextMenu.item.title}`} tabIndex={-1} style={{ left: contextMenu.x, top: contextMenu.y }}><button type="button" role="menuitem" disabled={busy} onClick={() => { setMoveItem(contextMenu.item); setMoveRoomId(contextMenu.item.room_id ?? ""); setContextMenu(null); }}>Move to…</button><button type="button" role="menuitem" disabled={busy} onClick={() => { const item = contextMenu.item; setContextMenu(null); void onCopyTranscript(item); }}><Copy size={14} aria-hidden="true" />Copy transcript</button><button type="button" role="menuitem" disabled={busy} onClick={() => { const item = contextMenu.item; setContextMenu(null); void onDownloadTranscript(item); }}><Download size={14} aria-hidden="true" />Download transcript (.md)</button>{!preview && <><button type="button" role="menuitem" onClick={() => { setContextMenu(null); onRename(contextMenu.item); }}><Pencil size={14} />Rename</button><button type="button" role="menuitem" disabled={busy} onClick={() => { setContextMenu(null); onArchive(contextMenu.item); }}><Archive size={14} />Archive</button></>}</div>}
    {moveItem && <dialog ref={moveDialogRef} className="thread-move-dialog" aria-labelledby={moveTitleId} onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); setMoveItem(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); const item = moveItem; setMoveItem(null); if (moveRoomId) setExpandedRooms((ids) => ids.includes(moveRoomId) ? ids : [...ids, moveRoomId]); void onMove(item, moveRoomId || null); }}>
        <h2 id={moveTitleId}>Move thread</h2><p>{moveItem.title}</p><label>Move to<select aria-label="Move to" value={moveRoomId} onChange={(event) => setMoveRoomId(event.target.value)}><option value="">General</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <div className="room-setup-actions"><button type="button" className="privacy-button" onClick={() => setMoveItem(null)}>Cancel</button><button type="submit" className="privacy-button" disabled={busy}>Move thread</button></div>
      </form>
    </dialog>}
    <div className="account-area"><div className="account-row"><AccountMenu email={email} name={name} releasePreview={releasePreview} signOutLabel={SIGN_OUT_LABEL} onOpenSettings={onOpenSettings} compact={collapsed && !mobile} /><button type="button" className={"icon-button account-settings" + (settingsActive ? " is-active" : "")} aria-label="Settings" title="Settings" aria-current={settingsActive ? "page" : undefined} onClick={onOpenSettings}><Settings size={16} aria-hidden="true" /></button></div></div>
    {searchOpen && <ConversationSearchDialog conversations={conversations} archivedConversations={archivedConversations} onOpen={onOpen} onRestore={onRestore} onClose={() => setSearchOpen(false)} />}
  </aside>;
});
