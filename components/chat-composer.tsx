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

// The draft lives here, not in the workspace: typing re-renders only this component, never the message list or sidebar.
export const ChatComposer = memo(function ChatComposer({ ref, dockRef, sending, streaming, mode, models, onModelChange, savingMode, caption, diagnostics, onEditProfile, onSubmit, onStop, onAttach, attachmentsEnabled = false, onRoomFiles, attachmentPanel = null, roomItems, roomId, roomLabel, roomSelectionNotice, roomsLoading, onRoomChange, centered = false }: Props) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [enterToSend] = useChatFlag("enterToSend");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    element.style.height = "0px";
    const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight);
    element.style.height = `${Math.min(element.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : 180)}px`;
  }, [draft, expanded, attachments.items.length]);

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

  function toggleExpanded() {
    const textarea = textareaRef.current;
    const selection = textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection } : null;
    setExpanded((value) => !value);
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      if (selection) textarea.setSelectionRange(selection.start, selection.end, selection.direction);
    });
  }

  const modelItems: MenuItem<ChatModel>[] = models.map((option) => ({ value: option.id, label: option.label, detail: option.credits === undefined ? option.description : `${option.description} · ${option.credits} credit${option.credits === 1 ? "" : "s"}` }));
  const hasDraft = draft.length > 0;
  const hasAttachments = attachments.items.length > 0 || Boolean(attachments.notice);
  const isActive = hasDraft || hasAttachments;

  return <div ref={dockRef} className={`composer-dock${centered ? " is-centered" : ""}`}>
    {attachmentPanel}
    <div className={`composer${expanded ? " is-expanded" : ""}${dragging ? " is-dropping" : ""}`}>
      <form ref={formRef} className={`composer-form${hasAttachments ? " has-attachments" : ""}${isActive ? " is-active" : ""}`} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {expanded ? <div className="composer-expanded-header"><span className="composer-expanded-label">Message</span><button className="composer-icon" type="button" aria-label="Collapse composer" title="Collapse composer" aria-expanded="true" onClick={toggleExpanded}><Minimize2 size={16} aria-hidden="true" /></button></div> : null}
        <div className="composer-content">
          <ComposerAttachments items={attachments.items} notice={attachments.notice} disabled={sending} onRemove={attachments.remove} onRetry={attachments.retry} />
          <textarea ref={textareaRef} aria-label="Message Nibie" placeholder="Ask Nibie anything..." enterKeyHint={enterToSend ? "send" : "enter"} value={draft} rows={1} onChange={(event) => { expandedBeforeClearRef.current = null; setDraft(event.target.value); }} onKeyDown={handleKeyDown} />
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
            {!expanded && isActive ? <button className="composer-icon composer-expand" type="button" aria-label="Expand composer" title="Expand composer" aria-expanded="false" onClick={toggleExpanded}><Maximize2 size={16} aria-hidden="true" /></button> : null}
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
      </div>
    </div>
    {caption ? <p className="composer-caption" role="status">{caption}</p> : null}
  </div>;
});
