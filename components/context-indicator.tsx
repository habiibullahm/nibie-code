"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ContextDiagnostics } from "@/lib/context/context-types";

function wideLabel(diagnostics: ContextDiagnostics) {
  const included = new Set(diagnostics.sources.filter((source) => source.state === "included").map((source) => source.type));
  const parts = ["Context"];
  if (included.has("profile")) parts.push("Profile");
  if (included.has("room")) parts.push("Room");
  if (included.has("pins")) parts.push("Pinned context");
  if (included.has("file")) parts.push("File context");
  if (included.has("thread_summary")) parts.push("Summary");
  if (included.has("recent_messages")) parts.push("Recent conversation");
  return parts.join(" · ");
}

function narrowLabel(diagnostics: ContextDiagnostics) {
  const included = new Set(diagnostics.sources.filter((source) => source.state === "included").map((source) => source.type));
  const profile = included.has("profile");
  const room = included.has("room");
  const pins = included.has("pins");
  const file = included.has("file");
  const summary = included.has("thread_summary");
  const recent = included.has("recent_messages");
  if (summary && (profile || recent || room || pins || file)) return "Context · Summary + thread";
  if (summary) return "Context · Summary";
  if (file && (profile || recent || room || pins)) return "Context · File + thread";
  if (file) return "Context · File";
  if (pins && room) return "Context · Room + pins";
  if (pins && recent) return "Context · Pins + thread";
  if (pins) return "Context · Pinned context";
  if (room && recent) return "Context · Room + thread";
  if (room && profile) return "Context · Profile + room";
  if (room) return "Context · Room";
  if (profile && recent) return "Context · Profile + thread";
  if (profile) return "Context · Profile";
  if (recent) return "Context · Thread";
  return "Context";
}

export function ContextIndicator({ diagnostics, onEditProfile }: { diagnostics: ContextDiagnostics; onEditProfile: () => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous && previous !== buttonRef.current) previous.focus();
    };
  }, [open]);

  return <div className="context-indicator">
    <button ref={buttonRef} type="button" className="context-indicator-button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      <span className="context-label-wide">{wideLabel(diagnostics)}</span>
      <span className="context-label-narrow">{narrowLabel(diagnostics)}</span>
    </button>
    {open ? <div className="context-layer">
      <button type="button" className="context-scrim" aria-label="Dismiss context" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} />
      <div ref={panelRef} id={panelId} className="context-panel" role="dialog" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>Using in this conversation</h2>
        <ul>
          {diagnostics.sources.map((source) => <li key={source.type}>
            <span className={source.state === "included" ? "context-mark is-included" : "context-mark"} aria-hidden="true">{source.state === "included" ? "✓" : "○"}</span>
            <span><strong>{source.label}</strong><small>{source.reason}</small></span>
          </li>)}
        </ul>
        <button type="button" className="context-edit" onClick={() => { setOpen(false); onEditProfile(); }}>Edit profile</button>
      </div>
    </div> : null}
  </div>;
}
