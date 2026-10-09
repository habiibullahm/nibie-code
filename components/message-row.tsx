"use client";

import { memo, useState, type KeyboardEvent } from "react";
import { Download, FilePenLine, FileText, Pencil, RefreshCw } from "lucide-react";
import { attachmentTypeLabel, formatBytes } from "@/lib/attachments/limits";
import type { AttachmentSummary } from "@/lib/attachments/types";
import { ResponseCopyButton } from "@/components/copy-button";
import { MessageMarkdown } from "@/components/message-markdown";
import { MessageSources } from "@/components/message-sources";
import { useChatFlag } from "@/components/use-chat-preferences";
import type { PersistedMessage } from "@/lib/chat/read";
import { formatMessageTimestamp } from "@/lib/chat/timestamps";
import { RESEARCH_STAGE_LABELS } from "@/lib/research/stages";
import { canContinueInWorkbench } from "@/lib/workbench/offer";

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
  /** Brief search-navigation highlight for the matched message. */
  highlighted?: boolean;
  // Label for the pre-first-token indicator (Responding… / Thinking… / Researching…); only the in-flight reply receives it.
  waitLabel?: string;
  onRegenerate: () => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, content: string) => void;
  onEditInWorkbench?: (messageId: string) => void;
  workbenchPending?: boolean;
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

// Sent attachments: name chip with owner-only download (signed URL via same-origin API).
function MessageAttachments({ attachments }: { attachments: AttachmentSummary[] }) {
  return <ul className="message-attachments" aria-label="Attachments">
    {attachments.map((attachment) => {
      const meta = `${attachment.name} · ${attachmentTypeLabel(attachment.mimeType)} · ${formatBytes(attachment.sizeBytes)}${attachment.truncated ? " · partly read" : ""}`;
      return <li key={attachment.id} className="message-attachment" title={meta}>
        <a
          className="message-attachment-download"
          href={`/api/chat/attachments/${attachment.id}/download`}
          download={attachment.name}
          aria-label={`Download ${attachment.name}`}
        >
          <FileText size={13} aria-hidden="true" />
          <span>{attachment.name}</span>
          <Download size={12} aria-hidden="true" className="message-attachment-download-icon" />
        </a>
      </li>;
    })}
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
export const MessageRow = memo(function MessageRow({ message, initial, isLast, isLastUser, canMutate, disabled, editing, responseFailed = false, highlighted = false, waitLabel, onRegenerate, onStartEdit, onCancelEdit, onSaveEdit, onEditInWorkbench, workbenchPending = false }: Props) {
  const highlightClass = highlighted ? " is-search-highlight" : "";
  if (message.role === "assistant") {
    const waiting = message.status === "streaming" && (!message.content || message.content === claimPlaceholder);
    const canCopy = message.status !== "streaming" && message.status !== "error" && Boolean(message.content) && !placeholderResponses.has(message.content);
    const canRegenerate = canMutate && isLast && message.status === "complete" && canCopy;
    const canRetry = canMutate && isLast && (message.status === "error" || message.status === "interrupted");
    const canWorkbench = Boolean(onEditInWorkbench) && canContinueInWorkbench(message);
    const responseStatus = message.actionLabel
      ? message.actionLabel
      : message.researchStage
        ? `Nibie is ${RESEARCH_STAGE_LABELS[message.researchStage].toLowerCase()}`
        : "Nibie is responding";
    // No author header. Before the first token a status label shows (after a 300ms grace period, in CSS); once text arrives it renders as-is, without motion.
    // Status labels (Deep Research, Used Web Search, Stopped, errors) and the optional timestamp keep a small meta line.
    const statuses = [
      message.research ? `Deep Research${message.research.status === "incomplete" ? " · Incomplete" : message.research.status === "failed" ? " · Failed" : ""}` : null,
      message.actionLabel && message.status === "complete" ? message.actionLabel : null,
      message.status === "interrupted" ? "Stopped" : null,
    ].filter(Boolean).join(" · ");
    const failed = message.status === "error";
    const waitingLabel = message.actionLabel
      ? message.actionLabel
      : message.researchStage
        ? "Researching…"
        : waitLabel ?? "Responding…";
    return <article id={`message-${message.id}`} data-message-id={message.id} className={`message-row assistant${highlightClass}`}>
      <div className="message-content assistant">
        {message.status === "streaming" ? <span className="visually-hidden" role="status">{responseStatus}</span> : null}
        {!waiting && (statuses || failed || message.created_at) ? <div className="message-author">
          {statuses ? <span className="message-status">{statuses}</span> : null}
          {failed ? <span className="message-status is-danger">{statuses ? " · " : ""}{"Couldn't respond"}</span> : null}
          <MessageTime value={message.created_at} />
        </div> : null}
        {waiting
          ? <div className="response-waiting"><span className="response-thinking" aria-hidden="true">{waitingLabel}</span>{message.researchStage && !message.actionLabel ? <span className="research-stage">{RESEARCH_STAGE_LABELS[message.researchStage]}</span> : null}</div>
          : <MessageMarkdown content={message.content} sources={message.sources} />}
        {message.sources?.length && !waiting ? <MessageSources sources={message.sources} /> : null}
        {(canCopy || canRegenerate || canRetry || canWorkbench) && <div className="message-actions">
          {canCopy && <ResponseCopyButton markdown={message.content} sources={message.sources} label="Copy response" iconOnly />}
          {canWorkbench && <button type="button" className="message-action is-icon-only" disabled={disabled || workbenchPending} aria-label="Edit in Workbench" title="Edit in Workbench" onClick={() => onEditInWorkbench?.(message.id)}><FilePenLine size={14} aria-hidden="true" /></button>}
          {canRegenerate && <button type="button" className="message-action is-icon-only" disabled={disabled} aria-label="Regenerate" title="Regenerate" onClick={onRegenerate}><RefreshCw size={14} aria-hidden="true" /></button>}
          {canRetry && <button type="button" className="message-action is-icon-only" disabled={disabled} aria-label="Retry" title="Retry" onClick={onRegenerate}><RefreshCw size={14} aria-hidden="true" /></button>}
        </div>}
      </div>
    </article>;
  }
  return <article id={`message-${message.id}`} data-message-id={message.id} className={`message-row user${highlightClass}`}>
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
