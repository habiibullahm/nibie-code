"use client";

import { useEffect, useId, useState } from "react";
import {
  getWorkbenchVersionAction,
  listWorkbenchVersionsAction,
  restoreWorkbenchVersionAction,
} from "@/app/actions/workbench";
import { MessageMarkdown } from "@/components/message-markdown";
import type { WorkbenchVersion, WorkbenchVersionSummary } from "@/lib/workbench/types";
import { formatWorkbenchVersionSource } from "@/lib/workbench/versions";

type Props = {
  documentId: string;
  expectedRevision: number;
  open: boolean;
  onClose: () => void;
  onRestored: (document: { title: string; content: string; revision: number }) => void;
};

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; versions: WorkbenchVersionSummary[] };

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; version: WorkbenchVersion };

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function WorkbenchHistory({ documentId, expectedRevision, open, onClose, onRestored }: Props) {
  const titleId = useId();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setList({ status: "loading" });
      setSelectedId(null);
      setPreview({ status: "idle" });
      setRestoreError("");
      const result = await listWorkbenchVersionsAction(documentId);
      if (cancelled) return;
      if (result.error) {
        setList({ status: "error", message: result.error });
        return;
      }
      const versions = result.data ?? [];
      setList({ status: "ready", versions });
      setSelectedId(versions[0]?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, documentId]);

  useEffect(() => {
    if (!open || !selectedId) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setPreview({ status: "loading" });
      setRestoreError("");
      const result = await getWorkbenchVersionAction({ documentId, versionId: selectedId });
      if (cancelled) return;
      if (result.error || !result.data) {
        setPreview({ status: "error", message: result.error ?? "That version is no longer available." });
        return;
      }
      setPreview({ status: "ready", version: result.data });
    })();
    return () => { cancelled = true; };
  }, [open, documentId, selectedId]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function restore() {
    if (!selectedId || restoring) return;
    if (!window.confirm("Restore this version? Your current document is saved as a new version first.")) return;
    setRestoring(true);
    setRestoreError("");
    const result = await restoreWorkbenchVersionAction({
      documentId,
      versionId: selectedId,
      expectedRevision,
    });
    setRestoring(false);
    if (result.conflict) {
      setRestoreError(result.error ?? "This document changed elsewhere. Reload before restoring.");
      return;
    }
    if (result.error || !result.data) {
      setRestoreError(result.error ?? "We couldn't restore that version.");
      return;
    }
    onRestored({
      title: result.data.title,
      content: result.data.content,
      revision: result.data.revision,
    });
    onClose();
  }

  const listError = list.status === "error" ? list.message : "";
  const previewError = preview.status === "error" ? preview.message : "";
  const alert = restoreError || listError || previewError;

  return <>
    <button type="button" className="workbench-history-scrim" aria-label="Close version history" onClick={onClose} />
    <aside
      className="workbench-history"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="workbench-history-top">
        <h2 id={titleId}>Version history</h2>
        <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}>Close</button>
      </header>
      {alert ? <p className="workbench-history-error" role="alert">{alert}</p> : null}
      <div className="workbench-history-body">
        <ul className="workbench-history-list" aria-label="Versions">
          {list.status === "loading" ? <li className="workbench-history-empty" role="status">Loading versions…</li> : null}
          {list.status === "ready" && list.versions.length === 0 ? (
            <li className="workbench-history-empty">No saved versions yet. Use Save version after an edit you want to keep.</li>
          ) : null}
          {list.status === "ready" ? list.versions.map((version) => (
            <li key={version.id}>
              <button
                type="button"
                className={selectedId === version.id ? "is-active" : undefined}
                aria-pressed={selectedId === version.id}
                onClick={() => setSelectedId(version.id)}
              >
                <span className="workbench-history-when">{formatWhen(version.created_at)}</span>
                <span className="workbench-history-source">{formatWorkbenchVersionSource(version.source)}</span>
                <span className="workbench-history-title">{version.title}</span>
              </button>
            </li>
          )) : null}
        </ul>
        <section className="workbench-history-preview" aria-label="Version preview">
          {preview.status === "loading" ? <p role="status">Loading preview…</p> : null}
          {preview.status === "ready" ? <>
            <h3>{preview.version.title}</h3>
            <div className="workbench-history-preview-body">
              {preview.version.content.trim()
                ? <MessageMarkdown content={preview.version.content} />
                : <p className="workbench-preview-empty">This version is empty.</p>}
            </div>
            <div className="workbench-history-actions">
              <button type="button" disabled={restoring || !selectedId} onClick={() => void restore()}>
                {restoring ? "Restoring…" : "Restore"}
              </button>
            </div>
          </> : null}
        </section>
      </div>
    </aside>
  </>;
}
