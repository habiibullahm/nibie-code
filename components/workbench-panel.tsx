"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WorkbenchEditor } from "@/components/workbench-editor";
import type { WorkbenchDocument } from "@/lib/workbench/types";

type Props = {
  documentId: string;
  onClose: () => void;
};

export function WorkbenchPanel({ documentId, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [doc, setDoc] = useState<WorkbenchDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    previousFocus.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    panelRef.current?.focus();
    return () => { previousFocus.current?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/workbench/documents/${documentId}`, { method: "GET" });
        const payload = await response.json().catch(() => null) as { document?: WorkbenchDocument; error?: string } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.document) {
          setError(payload?.error ?? "That document is no longer available.");
          setDoc(null);
          setLoading(false);
          return;
        }
        setDoc(payload.document);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError("Documents couldn't be loaded. Refresh to try again.");
        setDoc(null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <>
    <button type="button" className="workbench-panel-scrim" aria-label="Close editor backdrop" onClick={onClose} />
    <aside
      ref={panelRef}
      className="workbench-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <h2 id={titleId} className="visually-hidden">Workbench editor</h2>
      {loading ? <p className="workbench-panel-loading" role="status">Opening document…</p> : null}
      {error ? <div className="workbench-panel-error"><p role="alert">{error}</p><button type="button" className="icon-button" aria-label="Close editor" title="Close editor" onClick={onClose}>Close</button></div> : null}
      {doc ? <WorkbenchEditor document={doc} roomName={doc.room_name} variant="panel" onClose={onClose} /> : null}
    </aside>
  </>;
}
