"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BookOpenText, DoorOpen, FileText, Info, MessagesSquare, Pin, UserRound, type LucideIcon } from "lucide-react";
import type { ContextDiagnostics, ContextSourceDiagnostic } from "@/lib/context/context-types";

const sourceIcons: Record<ContextSourceDiagnostic["type"], LucideIcon> = {
  profile: UserRound,
  room: DoorOpen,
  pins: Pin,
  file: FileText,
  thread_summary: BookOpenText,
  recent_messages: MessagesSquare,
};

export function contextSourceStatus(source: ContextSourceDiagnostic) {
  if (source.state === "included") return source.type === "thread_summary" ? "Active" : "Included";
  if (source.reason === "Not needed yet.") return "Not needed";
  if (source.reason.startsWith("No ")) return "Empty";
  if (source.reason.startsWith("Preferences couldn't be loaded")) return "Defaults";
  return "Not used";
}

export function contextSourceDescription(source: ContextSourceDiagnostic) {
  if (source.type === "thread_summary" && source.reason === "Not needed yet.") return "Created when context gets long.";
  return source.reason;
}

export function ContextIndicator({ diagnostics, onEditProfile }: { diagnostics: ContextDiagnostics; onEditProfile: () => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous && previous !== button) previous.focus();
    };
  }, [open]);

  return <div className="context-indicator">
    <button ref={buttonRef} type="button" className="context-indicator-button" aria-label="Context" title="Context" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      <Info size={17} aria-hidden="true" />
    </button>
    {open ? <div className="context-layer">
      <button type="button" className="context-scrim" aria-label="Dismiss context" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} />
      <div ref={panelRef} id={panelId} className="context-panel" role="dialog" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>Context</h2>
        <p className="context-subtitle">What Nibie can use in this chat</p>
        <ul>
          {diagnostics.sources.map((source) => {
            const Icon = sourceIcons[source.type];
            return <li className="context-source" key={source.type}>
              <Icon className="context-source-icon" size={16} aria-hidden="true" />
              <span className="context-source-copy">
                <span className="context-source-heading"><strong>{source.label}</strong><span className="context-source-status">{contextSourceStatus(source)}</span></span>
                <small>{contextSourceDescription(source)}</small>
                {source.type === "profile" && <button type="button" className="context-edit" onClick={() => { setOpen(false); onEditProfile(); }}>Edit profile</button>}
              </span>
            </li>;
          })}
          {diagnostics.sources.length === 0 && <li className="context-empty">No context sources are available for this reply.</li>}
        </ul>
      </div>
    </div> : null}
  </div>;
}
