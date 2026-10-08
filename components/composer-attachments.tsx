"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RotateCcw, X } from "lucide-react";
import { attachmentTypeLabel, ATTACHMENT_TYPES, formatBytes, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENTS_TOTAL_BYTES } from "@/lib/attachments/limits";
import { attachmentErrors, checkAttachmentFile } from "@/lib/attachments/rules";
import type { AttachmentSummary } from "@/lib/attachments/types";
import { putFileToSignedUploadUrl } from "@/lib/attachments/upload-client";

export type DraftAttachment = {
  key: string;
  name: string;
  sizeBytes: number;
  typeLabel: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  // A failure the same file may get past on a second try (network or service), as opposed to a rejected file.
  retryable: boolean;
  file?: File;
  attachment?: AttachmentSummary;
  uploadId?: string;
};

const failedUpload = "We couldn't attach that file. Please try again.";

type UploadSessionResponse = {
  upload?: { uploadId: string; signedUrl: string; token: string; path: string; contentType: string };
  error?: string;
};

// Draft attachments of the composer. Each file is validated here, uploaded to Storage via a signed URL, then confirmed
// so the server can extract text into an unsent draft (original bytes are not kept).
export function useDraftAttachments() {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState("");
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => { for (const controller of controllers.current.values()) controller.abort(); }, []);

  const update = useCallback((key: string, patch: Partial<DraftAttachment>) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }, []);

  const upload = useCallback(async (key: string, file: File) => {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    let uploadId: string | undefined;
    try {
      const sessionResponse = await fetch("/api/chat/attachments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
        signal: controller.signal,
      });
      const sessionPayload = await sessionResponse.json().catch(() => null) as UploadSessionResponse | null;
      if (controller.signal.aborted) return;
      if (!sessionResponse.ok || !sessionPayload?.upload) {
        update(key, {
          status: "error",
          error: sessionPayload?.error ?? failedUpload,
          retryable: sessionResponse.status >= 500 || sessionResponse.status === 409,
        });
        return;
      }
      uploadId = sessionPayload.upload.uploadId;
      update(key, { uploadId });

      const put = await putFileToSignedUploadUrl(sessionPayload.upload.signedUrl, file, controller.signal);
      if (controller.signal.aborted) {
        void fetch("/api/chat/attachments/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadId, abort: true }),
        }).catch(() => undefined);
        return;
      }
      if (!put.ok) {
        void fetch("/api/chat/attachments/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadId, abort: true }),
        }).catch(() => undefined);
        update(key, { status: "error", error: failedUpload, retryable: true });
        return;
      }

      const confirmResponse = await fetch("/api/chat/attachments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId }),
        signal: controller.signal,
      });
      const confirmPayload = await confirmResponse.json().catch(() => null) as { attachment?: AttachmentSummary; error?: string } | null;
      if (controller.signal.aborted) return;
      if (confirmResponse.ok && confirmPayload?.attachment) {
        update(key, {
          status: "ready",
          attachment: confirmPayload.attachment,
          error: undefined,
          file: undefined,
          uploadId: undefined,
          name: confirmPayload.attachment.name,
          typeLabel: attachmentTypeLabel(confirmPayload.attachment.mimeType),
        });
      } else {
        update(key, {
          status: "error",
          error: confirmPayload?.error ?? failedUpload,
          retryable: confirmResponse.status >= 500 || confirmResponse.status === 409,
        });
      }
    } catch (error) {
      if (uploadId) {
        void fetch("/api/chat/attachments/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadId, abort: true }),
        }).catch(() => undefined);
      }
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      update(key, { status: "error", error: failedUpload, retryable: true });
    } finally {
      if (controllers.current.get(key) === controller) controllers.current.delete(key);
    }
  }, [update]);

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    setNotice("");
    const accepted: DraftAttachment[] = [];
    const kept = items.filter((item) => item.status !== "error");
    let count = kept.length;
    let total = kept.reduce((sum, item) => sum + item.sizeBytes, 0);
    let refused = "";
    for (const file of files) {
      const key = crypto.randomUUID();
      const checked = checkAttachmentFile(file);
      if ("error" in checked) {
        accepted.push({ key, name: file.name || "File", sizeBytes: file.size, typeLabel: "File", status: "error", error: checked.error, retryable: false });
        continue;
      }
      if (count >= MAX_ATTACHMENTS_PER_MESSAGE) { refused = attachmentErrors.tooMany; continue; }
      if (total + file.size > MAX_ATTACHMENTS_TOTAL_BYTES) { refused = attachmentErrors.totalTooLarge; continue; }
      count += 1;
      total += file.size;
      accepted.push({ key, name: checked.name, sizeBytes: file.size, typeLabel: ATTACHMENT_TYPES[checked.extension].label, status: "uploading", retryable: false, file });
    }
    if (refused) setNotice(refused);
    if (!accepted.length) return;
    setItems((current) => [...current, ...accepted]);
    for (const item of accepted) if (item.status === "uploading" && item.file) void upload(item.key, item.file);
  }, [items, upload]);

  const remove = useCallback((key: string) => {
    setNotice("");
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    const item = items.find((entry) => entry.key === key);
    // An unsent draft is deleted right away; if this request fails, the server removes it when the draft expires.
    if (item?.attachment) void fetch(`/api/chat/attachments/${item.attachment.id}`, { method: "DELETE" }).catch(() => undefined);
    setItems((current) => current.filter((entry) => entry.key !== key));
  }, [items]);

  const retry = useCallback((key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item?.file || !item.retryable) return;
    update(key, { status: "uploading", error: undefined, uploadId: undefined });
    void upload(key, item.file);
  }, [items, update, upload]);

  // Sending reads the ready attachments; they leave the composer only when the sent message clears it, and a failed
  // send puts them back. The drafts themselves are not deleted: the sent message now owns them.
  const ready = items.flatMap((item) => item.attachment && item.status === "ready" ? [item.attachment] : []);
  const reset = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setItems([]);
    setNotice("");
  }, []);
  const restore = useCallback((attachments: AttachmentSummary[]) => {
    if (!attachments.length) return;
    setItems((current) => current.length ? current : attachments.map((attachment) => ({
      key: attachment.id, name: attachment.name, sizeBytes: attachment.sizeBytes, typeLabel: attachmentTypeLabel(attachment.mimeType), status: "ready" as const, retryable: false, attachment,
    })));
  }, []);

  const uploading = items.some((item) => item.status === "uploading");
  const failed = items.some((item) => item.status === "error");
  return { items, notice, add, remove, retry, ready, reset, restore, uploading, failed };
}

export function ComposerAttachments({ items, notice, disabled, onRemove, onRetry }: { items: DraftAttachment[]; notice: string; disabled: boolean; onRemove: (key: string) => void; onRetry: (key: string) => void }) {
  if (!items.length && !notice) return null;
  const failures = items.filter((item) => item.status === "error");
  return <div className="composer-attachments">
    {items.length ? <ul className="attachment-chips" aria-label="Attachments">
      {items.map((item) => <li key={item.key} className={`attachment-chip is-${item.status}`}>
        <FileText size={14} aria-hidden="true" />
        <span className="attachment-chip-text">
          <span className="attachment-chip-name" title={item.name}>{item.name}</span>
          <span className="attachment-chip-meta">{item.status === "uploading" ? "Reading…" : item.status === "error" ? "Couldn't attach" : `${item.typeLabel} · ${formatBytes(item.sizeBytes)}${item.attachment?.truncated ? " · partly read" : ""}`}</span>
        </span>
        {item.status === "error" && item.retryable ? <button type="button" className="attachment-chip-action" aria-label={`Retry ${item.name}`} title="Retry" disabled={disabled} onClick={() => onRetry(item.key)}><RotateCcw size={13} aria-hidden="true" /></button> : null}
        <button type="button" className="attachment-chip-action" aria-label={`Remove ${item.name}`} title="Remove" disabled={disabled} onClick={() => onRemove(item.key)}><X size={13} aria-hidden="true" /></button>
      </li>)}
    </ul> : null}
    {failures.map((item) => <p key={item.key} className="attachment-error" role="alert">{item.name}: {item.error}</p>)}
    {notice ? <p className="attachment-error" role="alert">{notice}</p> : null}
  </div>;
}
