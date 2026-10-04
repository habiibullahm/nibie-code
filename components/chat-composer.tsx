"use client";

import { memo, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { ArrowUp, Maximize2, Minimize2, Plus, X } from "lucide-react";
import { ComposerMenu, type MenuItem } from "@/components/composer-menu";
import { ContextIndicator } from "@/components/context-indicator";
import { useChatFlag } from "@/components/use-chat-preferences";
import { composerEnterAction } from "@/lib/chat/preferences";
import type { ModelOption } from "@/lib/chat/models";
import type { ChatModel } from "@/lib/chat/validation";
import type { ContextDiagnostics } from "@/lib/context/context-types";

export type ComposerHandle = { set: (text: string) => void; restore: (text: string) => void; clear: () => void; focus: () => void };
type Props = {
  ref?: Ref<ComposerHandle>;
  dockRef?: Ref<HTMLDivElement>;
  sending: boolean;
  streaming: boolean;
  // The one capability picker (Fast / Balanced / High). It picks routing only, never answer length.
  mode: ChatModel;
  models: ModelOption[];
  onModelChange: (model: ChatModel) => void;
  caption: string | null;
  diagnostics: ContextDiagnostics;
  onEditProfile: () => void;
  onSubmit: (content: string) => void;
  onStop: () => void;
  onAttach: () => void;
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
export const ChatComposer = memo(function ChatComposer({ ref, dockRef, sending, streaming, mode, models, onModelChange, caption, diagnostics, onEditProfile, onSubmit, onStop, onAttach, attachmentPanel = null, roomItems, roomId, roomLabel, roomSelectionNotice, roomsLoading, onRoomChange, centered = false }: Props) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [enterToSend] = useChatFlag("enterToSend");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedBeforeClearRef = useRef<boolean | null>(null);
  useImperativeHandle(ref, () => ({
    set: (text) => { expandedBeforeClearRef.current = null; setDraft(text); },
    restore: (text) => {
      setDraft((current) => current || text);
      setExpanded(expandedBeforeClearRef.current ?? (text.includes("\n") || text.length > 120));
      expandedBeforeClearRef.current = null;
    },
    clear: () => { expandedBeforeClearRef.current = expanded; setDraft(""); setExpanded(false); },
    focus: () => textareaRef.current?.focus(),
  }), [expanded]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight);
    element.style.height = `${Math.min(element.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : 180)}px`;
  }, [draft, expanded]);

  function submit() {
    const content = draft.trim();
    if (content && !sending && !streaming) onSubmit(content);
  }
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

  const modelItems: MenuItem<ChatModel>[] = models.map((option) => ({ value: option.id, label: option.label, detail: option.description }));
  const showExpandControl = expanded || draft.includes("\n") || draft.length > 120;

  return <div ref={dockRef} className={`composer-dock${centered ? " is-centered" : ""}`}>
    {attachmentPanel}
    <div className={`composer${expanded ? " is-expanded" : ""}`}>
      <form className="composer-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <textarea ref={textareaRef} aria-label="Message Nibie" placeholder="Ask Nibie..." enterKeyHint={enterToSend ? "send" : "enter"} value={draft} rows={1} onChange={(event) => { expandedBeforeClearRef.current = null; setDraft(event.target.value); }} onKeyDown={handleKeyDown} />
        <div className="composer-actions">
          <button className="composer-icon" type="button" aria-label="Attach file" title="Attach file" aria-pressed={Boolean(attachmentPanel)} onClick={onAttach}><Plus size={18} /></button>
          <div className="composer-actions-right"><ContextIndicator diagnostics={diagnostics} onEditProfile={onEditProfile} />{showExpandControl ? <button className="composer-icon" type="button" aria-label={expanded ? "Collapse composer" : "Expand composer"} title={expanded ? "Collapse composer" : "Expand composer"} onClick={toggleExpanded}>{expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button> : null}{streaming ? <button key="stop" className="send-button" type="button" aria-label="Stop response" onClick={onStop}><X size={18} /></button> : <button key="send" className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || sending}>{sending ? <span className="send-spinner" /> : <ArrowUp size={18} strokeWidth={2.3} />}</button>}</div>
        </div>
      </form>
    </div>
    {onRoomChange && roomSelectionNotice ? <p className="composer-room-notice" role="status">{roomSelectionNotice}</p> : null}
    <div className="composer-tools composer-secondary-tools">
      <div className="composer-left-tools">
        {onRoomChange ? <ComposerMenu name="Room" description="Choose where this conversation belongs." value={roomId} items={roomItems} onChange={onRoomChange} disabled={sending || streaming || roomsLoading} disabledReason={roomsLoading ? "Loading rooms" : "Message is being sent"} /> : <span className="composer-room-context" aria-label={`Room context: ${roomLabel}`} title={roomLabel}>{roomLabel}</span>}
        <ComposerMenu name="Model" value={mode} items={modelItems} onChange={onModelChange} disabled={sending || streaming || !models.length} disabledReason="A response is running or no models are configured" />
      </div>
    </div>
    {caption ? <p className="composer-caption" role="status">{caption}</p> : null}
  </div>;
});
