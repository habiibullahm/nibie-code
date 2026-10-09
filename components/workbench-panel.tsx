"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WorkbenchEditor } from "@/components/workbench-editor";
import type { WorkbenchDocument } from "@/lib/workbench/types";

type Props = {
  documentId: string;
  onClose: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; document: WorkbenchDocument };

export function WorkbenchPanel({ documentId, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    previousFocus.current = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
    panelRef.current?.focus();
    return () => { previousFocus.current?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/workbench/documents/${documentId}`, { method: "GET" });
        const payload = await response.json().catch(() => null) as { document?: WorkbenchDocument; error?: string } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.document) {
          setLoad({ status: "error", message: payload?.error ?? "That document is no longer available." });
          return;
        }
        setLoad({ status: "ready", document: payload.document });
      } catch {
        if (cancelled) return;
        setLoad({ status: "error", message: "Documents couldn't be loaded. Refresh to try again." });
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
      {load.status === "loading" ? <p className="workbench-panel-loading" role="status">Opening document…</p> : null}
      {load.status === "error" ? <div className="workbench-panel-error"><p role="alert">{load.message}</p><button type="button" className="icon-button" aria-label="Close editor" title="Close editor" onClick={onClose}>Close</button></div> : null}
      {load.status === "ready" ? <WorkbenchEditor document={load.document} roomName={load.document.room_name} variant="panel" onClose={onClose} /> : null}
    </aside>
  </>;
}
