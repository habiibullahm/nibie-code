"use client";

import { memo, useState, type KeyboardEvent } from "react";
import { FileText, Pencil, RefreshCw } from "lucide-react";
import { attachmentTypeLabel, formatBytes } from "@/lib/attachments/limits";
import type { AttachmentSummary } from "@/lib/attachments/types";
import { CopyButton } from "@/components/copy-button";
import { MessageMarkdown } from "@/components/message-markdown";
import { useChatFlag } from "@/components/use-chat-preferences";
import type { PersistedMessage } from "@/lib/chat/read";
import { formatMessageTimestamp } from "@/lib/chat/timestamps";

const placeholderResponses = new Set(["Response stopped.", "Response unavailable."]);
// Content of a saved reply the server has claimed but not written yet.
const claimPlaceholder = "…";

type Props = {
  message: PersistedMessage;
  initial: string;
  isLast: boolean;
  isLastUser: boolean;
  canMutate: boolean;
  disabled: boolean;
  editing: boolean;
  responseFailed?: boolean;
  onRegenerate: () => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, content: string) => void;
};

function MessageEditor({ message, disabled, onCancel, onSave }: { message: PersistedMessage; disabled: boolean; onCancel: () => void; onSave: (content: string) => void }) {
  const [text, setText] = useState(message.content);
  const trimmed = text.trim();
  const unchanged = !trimmed || trimmed === message.content;
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !unchanged && !disabled) { event.preventDefault(); onSave(trimmed); }
  }
  return <div className="message-editor">
    <textarea aria-label="Edit message" autoFocus rows={3} maxLength={20_000} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={handleKeyDown} />
    <div className="message-editor-actions"><button type="button" className="message-action" onClick={onCancel}>Cancel</button><button type="button" className="message-action is-primary" disabled={disabled || unchanged} onClick={() => onSave(trimmed)}>Save &amp; resend</button></div>
  </div>;
}

// Names only: a sent attachment is shown as a small chip, never as a preview or a link.
function MessageAttachments({ attachments }: { attachments: AttachmentSummary[] }) {
  return <ul className="message-attachments" aria-label="Attachments">
    {attachments.map((attachment) => <li key={attachment.id} className="message-attachment" title={`${attachment.name} · ${attachmentTypeLabel(attachment.mimeType)} · ${formatBytes(attachment.sizeBytes)}${attachment.truncated ? " · partly read" : ""}`}>
      <FileText size={13} aria-hidden="true" /><span>{attachment.name}</span>
    </li>)}
  </ul>;
}

function MessageTime({ value }: { value: string | undefined }) {
  const [showTimestamps] = useChatFlag("showTimestamps");
  if (!showTimestamps || !value) return null;
  const label = formatMessageTimestamp(value);
  if (!label) return null;
  return <time className="message-time" dateTime={value}>{label}</time>;
}

// Memoized per message: while a reply streams, only the row whose message object changed re-renders.
export const MessageRow = memo(function MessageRow({ message, initial, isLast, isLastUser, canMutate, disabled, editing, responseFailed = false, onRegenerate, onStartEdit, onCancelEdit, onSaveEdit }: Props) {
  if (message.role === "assistant") {
    const waiting = message.status === "streaming" && (!message.content || message.content === claimPlaceholder);
    const canCopy = message.status !== "streaming" && message.status !== "error" && Boolean(message.content) && !placeholderResponses.has(message.content);
    const canRegenerate = canMutate && isLast && message.status === "complete" && canCopy;
    const canRetry = canMutate && isLast && (message.status === "error" || message.status === "interrupted");
    return <article className="message-row assistant">
      <div className="message-content assistant">
        <div className="message-author">Nibie{message.status === "interrupted" ? <span className="message-status"> · Stopped</span> : message.status === "error" ? <span className="message-status is-danger">{" · Couldn't respond"}</span> : null}<MessageTime value={message.created_at} /></div>
        {waiting ? <span className="thinking-dots" role="status" aria-label="Nibie is responding"><i /><i /><i /></span> : <><MessageMarkdown content={message.content} />{message.status === "streaming" && <span className="thinking-dots is-inline" role="status" aria-label="Nibie is responding"><i /><i /><i /></span>}</>}
        {(canCopy || canRegenerate || canRetry) && <div className="message-actions">
          {canCopy && <CopyButton text={message.content} label="Copy response" />}
          {canRegenerate && <button type="button" className="message-action" disabled={disabled} onClick={onRegenerate}><RefreshCw size={13} aria-hidden="true" /><span>Regenerate</span></button>}
          {canRetry && <button type="button" className="message-action" disabled={disabled} onClick={onRegenerate}><RefreshCw size={13} aria-hidden="true" /><span>Retry</span></button>}
        </div>}
      </div>
    </article>;
  }
  return <article className="message-row user">
    {editing
      ? <div className="message-column user"><MessageEditor message={message} disabled={disabled} onCancel={onCancelEdit} onSave={(content) => onSaveEdit(message.id, content)} /></div>
      : <div className="message-column user">
        {message.attachments?.length ? <MessageAttachments attachments={message.attachments} /> : null}
        <div className="message-content user"><p>{message.content}</p></div>
        <MessageTime value={message.created_at} />
        {canMutate && isLastUser && <div className="message-actions">
          <button type="button" className="message-action" disabled={disabled} onClick={() => onStartEdit(message.id)}><Pencil size={13} aria-hidden="true" /><span>Edit</span></button>
          {isLast && responseFailed && <button type="button" className="message-action" disabled={disabled} onClick={onRegenerate}><RefreshCw size={13} aria-hidden="true" /><span>Retry</span></button>}
        </div>}
      </div>}
    <div className="user-avatar" aria-label="You">{initial}</div>
  </article>;
});
