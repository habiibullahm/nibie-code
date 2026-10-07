"use client";

import { memo, useState, type KeyboardEvent } from "react";
import { FileText, Pencil, RefreshCw } from "lucide-react";
import { attachmentTypeLabel, formatBytes } from "@/lib/attachments/limits";
import type { AttachmentSummary } from "@/lib/attachments/types";
import { BrandMark } from "@/components/brand";
import { CopyButton } from "@/components/copy-button";
import { MessageMarkdown } from "@/components/message-markdown";
import { MessageSources } from "@/components/message-sources";
import { useChatFlag } from "@/components/use-chat-preferences";
import type { PersistedMessage } from "@/lib/chat/read";
import { formatMessageTimestamp } from "@/lib/chat/timestamps";
import { RESEARCH_STAGE_LABELS } from "@/lib/research/stages";

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
    const responseStatus = message.researchStage ? `Nibie is ${RESEARCH_STAGE_LABELS[message.researchStage].toLowerCase()}` : "Nibie is responding";
    // No author header: the animated mark appears only while Nibie is thinking, and the caret covers streaming.
    // Status labels (Deep Research, Stopped, errors) and the optional timestamp keep a small meta line.
    const statuses = [
      message.research ? `Deep Research${message.research.status === "incomplete" ? " · Incomplete" : message.research.status === "failed" ? " · Failed" : ""}` : null,
      message.status === "interrupted" ? "Stopped" : null,
    ].filter(Boolean).join(" · ");
    const failed = message.status === "error";
    return <article className="message-row assistant">
      <div className="message-content assistant">
        {message.status === "streaming" ? <span className="visually-hidden" role="status">{responseStatus}</span> : null}
        {!waiting && (statuses || failed || message.created_at) ? <div className="message-author">
          {statuses ? <span className="message-status">{statuses}</span> : null}
          {failed ? <span className="message-status is-danger">{statuses ? " · " : ""}{"Couldn't respond"}</span> : null}
          <MessageTime value={message.created_at} />
        </div> : null}
        {waiting
          ? <div className="response-thinking"><BrandMark activity="thinking" />{message.researchStage ? <span className="research-stage">{RESEARCH_STAGE_LABELS[message.researchStage]}</span> : null}</div>
          : <MessageMarkdown content={message.content} sources={message.sources} streaming={message.status === "streaming"} />}
        {message.sources?.length && !waiting ? <MessageSources sources={message.sources} /> : null}
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
