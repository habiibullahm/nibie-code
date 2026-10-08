"use client";

import { memo, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { ArrowUp, FileText, Maximize2, Minimize2, Paperclip, Plus, X } from "lucide-react";
import { ComposerAttachments, useDraftAttachments } from "@/components/composer-attachments";
import { ComposerMenu, type MenuItem } from "@/components/composer-menu";
import { ContextIndicator } from "@/components/context-indicator";
import { useChatFlag } from "@/components/use-chat-preferences";
import { composerEnterAction } from "@/lib/chat/preferences";
import type { ModelOption } from "@/lib/chat/models";
import type { ChatModel } from "@/lib/chat/validation";
import type { ContextDiagnostics } from "@/lib/context/context-types";
import { ATTACHMENT_ACCEPT } from "@/lib/attachments/limits";
import type { AttachmentSummary } from "@/lib/attachments/types";

export type ComposerHandle = { set: (text: string) => void; restore: (text: string, attachments?: AttachmentSummary[]) => void; clear: () => void; focus: () => void };
type Props = {
  ref?: Ref<ComposerHandle>;
  dockRef?: Ref<HTMLDivElement>;
  sending: boolean;
  streaming: boolean;
  // The one capability picker (Fast / Balanced / High). It picks routing only, never answer length.
  mode: ChatModel;
  models: ModelOption[];
  onModelChange: (model: ChatModel) => void;
  /** Explicit research control — orthogonal to Fast/Balanced/High. */
  researchMode: "normal" | "deep";
  onResearchModeChange: (mode: "normal" | "deep") => void;
  // True only while a mode change is being saved; the picker says so instead of claiming a response is running.
  savingMode: boolean;
  caption: string | null;
  diagnostics: ContextDiagnostics;
  onEditProfile: () => void;
  onSubmit: (content: string, attachments: AttachmentSummary[]) => void;
  onStop: () => void;
  // When files can't be attached here (the local preview), "+" explains why instead.
  onAttach: () => void;
  attachmentsEnabled?: boolean;
  // In a room thread, "+" also offers that room's files.
  onRoomFiles?: () => void;
  attachmentPanel?: ReactNode;
  roomItems: MenuItem<string>[];
  roomId: string;
  roomLabel: string;
  roomSelectionNotice: string | null;
  roomsLoading: boolean;
  onRoomChange?: (id: string) => void;
  centered?: boolean;
};

function fitCollapsedTextarea(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight);
  element.style.height = `${Math.min(element.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : 180)}px`;
  return element.scrollHeight > (Number.isFinite(maxHeight) ? maxHeight : element.clientHeight) + 1;
}

// The draft lives here, not in the workspace: typing re-renders only this component, never the message list or sidebar.
export const ChatComposer = memo(function ChatComposer({ ref, dockRef, sending, streaming, mode, models, onModelChange, researchMode, onResearchModeChange, savingMode, caption, diagnostics, onEditProfile, onSubmit, onStop, onAttach, attachmentsEnabled = false, onRoomFiles, attachmentPanel = null, roomItems, roomId, roomLabel, roomSelectionNotice, roomsLoading, onRoomChange, centered = false }: Props) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [enterToSend] = useChatFlag("enterToSend");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const attachments = useDraftAttachments();
  const { reset: resetAttachments, restore: restoreAttachments } = attachments;
  const expandedBeforeClearRef = useRef<boolean | null>(null);
  useImperativeHandle(ref, () => ({
    set: (text) => { expandedBeforeClearRef.current = null; setDraft(text); setExpanded(false); },
    restore: (text, restored = []) => {
      setDraft((current) => current || text);
      setExpanded(expandedBeforeClearRef.current ?? false);
      expandedBeforeClearRef.current = null;
      restoreAttachments(restored);
    },
    clear: () => { expandedBeforeClearRef.current = expanded; setDraft(""); setExpanded(false); resetAttachments(); },
    focus: () => textareaRef.current?.focus(),
  }), [expanded, resetAttachments, restoreAttachments]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    if (expanded) {
      element.style.height = "";
      return;
    }
    setCanExpand(fitCollapsedTextarea(element));
  }, [draft, expanded, attachments.items.length]);
  // Remember the last focused selection so Expand/Collapse can restore it after the button steals focus.
  useEffect(() => {
    const onSelectionChange = () => {
      const element = textareaRef.current;
      if (!element || document.activeElement !== element) return;
      selectionRef.current = { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection };
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    let observedWidth = -1;
    const fit = () => {
      if (expanded) { setCanExpand(false); return; }
      setCanExpand(fitCollapsedTextarea(element));
    };
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      if (Math.abs(width - observedWidth) < 1) return;
      observedWidth = width;
      fit();
    });
    observer.observe(element);
    window.addEventListener("resize", fit);
    fit();
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const dialog = composerRef.current;
    const workspace = dialog?.closest<HTMLElement>(".chat-workspace");
    if (!dialog || !workspace) return;
    const inerted: { element: HTMLElement; wasInert: boolean }[] = [];
    let branch: HTMLElement = dialog;
    while (branch !== workspace) {
      const parent = branch.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        inerted.push({ element: sibling, wasInert: sibling.inert });
        sibling.inert = true;
      }
      branch = parent;
    }
    return () => { for (const { element, wasInert } of inerted) element.inert = wasInert; };
  }, [expanded]);

  // Files can be attached while a reply streams, for the next message. A message waits for its attachments: none still reading, and none failed (a failed one is removed or retried first).
  const attachmentsBlocked = attachments.uploading || attachments.failed;
  function submit() {
    const content = draft.trim();
    if (content && !sending && !streaming && !attachmentsBlocked) onSubmit(content, attachments.ready);
  }
  function chooseFiles() {
    setAttachMenuOpen(false);
    fileInputRef.current?.click();
  }
  function plus() {
    if (!attachmentsEnabled) { onAttach(); return; }
    if (onRoomFiles) { setAttachMenuOpen((open) => !open); return; }
    chooseFiles();
  }
  // Files dropped on the composer are attached like chosen ones. Native listeners, so the drag handlers run for every
  // dragover the browser sends while files are held over the form.
  const formRef = useRef<HTMLFormElement>(null);
  const dropTarget = useRef({ add: attachments.add, busy: sending });
  useEffect(() => { dropTarget.current = { add: attachments.add, busy: sending }; });
  useEffect(() => {
    const form = formRef.current;
    if (!form || !attachmentsEnabled) return;
    const holdsFiles = (event: globalThis.DragEvent) => Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files"));
    const over = (event: globalThis.DragEvent) => { if (!holdsFiles(event)) return; event.preventDefault(); setDragging(true); };
    const leave = (event: globalThis.DragEvent) => { if (!form.contains(event.relatedTarget as Node | null)) setDragging(false); };
    const drop = (event: globalThis.DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      event.preventDefault();
      setDragging(false);
      if (!dropTarget.current.busy) dropTarget.current.add([...files]);
    };
    form.addEventListener("dragover", over);
    form.addEventListener("dragleave", leave);
    form.addEventListener("drop", drop);
    return () => { form.removeEventListener("dragover", over); form.removeEventListener("dragleave", leave); form.removeEventListener("drop", drop); };
  }, [attachmentsEnabled]);
  useEffect(() => {
    if (!attachMenuOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown" && (event.target as Element | null)?.closest?.(".attach-menu, .composer-attach")) return;
      setAttachMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [attachMenuOpen]);
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const action = composerEnterAction({ key: event.key, shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey, composing: event.nativeEvent.isComposing, enterToSend });
    if (action === "send") { event.preventDefault(); submit(); }
  }
  function handleExpandedKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!expanded) return;
    if (event.key === "Escape") { event.preventDefault(); toggleExpanded(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function toggleExpanded() {
    const textarea = textareaRef.current;
    const selection = selectionRef.current ?? (textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection } : null);
    setExpanded((value) => !value);
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      if (selection) textarea.setSelectionRange(selection.start, selection.end, selection.direction);
    });
  }

  const modelItems: MenuItem<ChatModel>[] = models.map((option) => ({ value: option.id, label: option.label, detail: option.credits === undefined ? option.description : `${option.description} · ${option.credits} credit${option.credits === 1 ? "" : "s"}` }));
  const researchItems: MenuItem<"normal" | "deep">[] = [
    { value: "normal", label: "Normal", detail: "Standard reply · web when needed" },
    { value: "deep", label: "Deep Research", detail: "Multi-source gather · compare · cite · costs more" },
  ];
  const hasDraft = draft.length > 0;
  const hasAttachments = attachments.items.length > 0 || Boolean(attachments.notice);
  const isActive = hasDraft || hasAttachments;

  return <div ref={dockRef} className={`composer-dock${centered ? " is-centered" : ""}`}>
    {attachmentPanel}
    <div ref={composerRef} className={`composer${expanded ? " is-expanded" : ""}${dragging ? " is-dropping" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded ? "true" : undefined} aria-label={expanded ? "Expanded message composer" : undefined} onKeyDown={handleExpandedKeyDown}>
      <form ref={formRef} className={`composer-form${hasAttachments ? " has-attachments" : ""}${isActive ? " is-active" : ""}`} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {expanded ? <div className="composer-expanded-header"><span className="composer-expanded-label">Message</span><button className="composer-icon" type="button" aria-label="Collapse composer" title="Collapse composer" aria-expanded="true" onMouseDown={(event) => event.preventDefault()} onClick={toggleExpanded}><Minimize2 size={16} aria-hidden="true" /></button></div> : null}
        <div className="composer-content">
          <ComposerAttachments items={attachments.items} notice={attachments.notice} disabled={sending} onRemove={attachments.remove} onRetry={attachments.retry} />
          <textarea ref={textareaRef} aria-label="Message Nibie" placeholder={centered ? "Ask Nibie anything..." : "Reply to Nibie..."} enterKeyHint={enterToSend ? "send" : "enter"} value={draft} rows={1} onChange={(event) => { expandedBeforeClearRef.current = null; setDraft(event.target.value); }} onKeyDown={handleKeyDown} onSelect={(event) => { const element = event.currentTarget; selectionRef.current = { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection }; }} />
        </div>
        {attachmentsEnabled ? <input ref={fileInputRef} className="composer-file-input" type="file" multiple accept={ATTACHMENT_ACCEPT} tabIndex={-1} aria-hidden="true" onChange={(event) => { attachments.add([...(event.target.files ?? [])]); event.target.value = ""; }} /> : null}
        <div className="composer-footer">
          <span className="composer-attach">
            <button className="composer-icon" type="button" aria-label="Attach file" title="Attach file" aria-haspopup={attachmentsEnabled && onRoomFiles ? "menu" : undefined} aria-expanded={attachmentsEnabled && onRoomFiles ? attachMenuOpen : undefined} aria-pressed={attachmentsEnabled && onRoomFiles ? undefined : Boolean(attachmentPanel)} disabled={attachmentsEnabled && sending} onClick={plus}><Plus size={18} /></button>
            {attachMenuOpen ? <span className="attach-menu" role="menu" aria-label="Attach">
              <button type="button" role="menuitem" onClick={chooseFiles}><Paperclip size={14} aria-hidden="true" />Upload from device</button>
              <button type="button" role="menuitemcheckbox" aria-checked={Boolean(attachmentPanel)} onClick={() => { setAttachMenuOpen(false); onRoomFiles?.(); }}><FileText size={14} aria-hidden="true" />Room files</button>
            </span> : null}
          </span>
          <div className="composer-actions">
            <ContextIndicator diagnostics={diagnostics} onEditProfile={onEditProfile} />
            {!expanded && canExpand ? <button className="composer-icon composer-expand" type="button" aria-label="Expand composer" title="Expand composer" aria-expanded="false" onMouseDown={(event) => event.preventDefault()} onClick={toggleExpanded}><Maximize2 size={16} aria-hidden="true" /></button> : null}
            {streaming ? <button key="stop" className="send-button" type="button" aria-label="Stop response" onClick={onStop}><X size={18} /></button> : <button key="send" className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || sending || attachmentsBlocked}>{sending ? <span className="send-spinner" /> : <ArrowUp size={18} strokeWidth={2.3} />}</button>}
          </div>
        </div>
      </form>
    </div>
    {onRoomChange && roomSelectionNotice ? <p className="composer-room-notice" role="status">{roomSelectionNotice}</p> : null}
    <div className="composer-tools composer-secondary-tools">
      <div className="composer-left-tools">
        {onRoomChange ? <ComposerMenu name="Room" description="Choose where this conversation belongs." value={roomId} items={roomItems} onChange={onRoomChange} disabled={sending || streaming || roomsLoading} disabledReason={roomsLoading ? "Loading rooms" : "Message is being sent"} /> : <span className="composer-room-context" aria-label={`Room context: ${roomLabel}`} title={roomLabel}>{roomLabel}</span>}
        <ComposerMenu name="Model" value={mode} items={modelItems} onChange={onModelChange} disabled={sending || streaming || !models.length} disabledReason={!models.length ? "No models are configured" : savingMode ? "Saving…" : "A response is running"} />
        <ComposerMenu name="Research" description="Choose how far Nibie should research before answering." value={researchMode} items={researchItems} onChange={onResearchModeChange} disabled={sending || streaming} disabledReason="A response is running" />
      </div>
    </div>
    {caption ? <p className="composer-caption" role="status">{caption}</p> : null}
  </div>;
});
