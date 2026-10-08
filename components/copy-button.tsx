"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import {
  markdownToClipboard,
  writeFormattedClipboard,
  writePlainClipboard,
  type ClipboardCitationSource,
} from "@/lib/markdown/clipboard";

type Feedback = "idle" | "copied" | "failed";

function useCopyFeedback() {
  const [state, setState] = useState<Feedback>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function report(next: Feedback) {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }
  return { state, report };
}

// iconOnly shows just the icon (a check once copied); the label stays the accessible name and tooltip, and the
// result is still announced to screen readers.
export function CopyButton({ text, label, compact = false, iconOnly = false }: { text: string; label: string; compact?: boolean; iconOnly?: boolean }) {
  const { state, report } = useCopyFeedback();

  async function copy() {
    try {
      await writePlainClipboard(text);
      report("copied");
    } catch {
      report("failed");
    }
  }

  const status = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
  return <button type="button" className={`copy-button${compact ? " is-compact" : ""}${iconOnly ? " is-icon-only" : ""}`} aria-label={label} title={state === "idle" ? label : status} onClick={() => void copy()}>
    {state === "copied" ? <Check size={iconOnly ? 14 : 13} aria-hidden="true" /> : <Copy size={iconOnly ? 14 : 13} aria-hidden="true" />}
    <span className={iconOnly ? "visually-hidden" : undefined} aria-live="polite">{iconOnly && state === "idle" ? "" : status}</span>
  </button>;
}

type ResponseCopyProps = {
  markdown: string;
  sources?: readonly ClipboardCitationSource[];
  label?: string;
};

/**
 * Response copy control: default action copies Word-safe formatted HTML + plain text;
 * a small adjacent menu offers clean plain-text copy. Code-block CopyButton stays unchanged.
 */
export function ResponseCopyButton({ markdown, sources, label = "Copy response" }: ResponseCopyProps) {
  const { state, report } = useCopyFeedback();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const plainItemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    plainItemRef.current?.focus();
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [menuOpen]);

  async function copyFormatted() {
    setMenuOpen(false);
    try {
      const { html, plain } = markdownToClipboard(markdown, sources);
      await writeFormattedClipboard(html, plain);
      report("copied");
    } catch {
      report("failed");
    }
  }

  async function copyPlain() {
    setMenuOpen(false);
    try {
      const { plain } = markdownToClipboard(markdown, sources);
      await writePlainClipboard(plain);
      report("copied");
    } catch {
      report("failed");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    } else if (event.key === "Tab") {
      setMenuOpen(false);
    }
  }

  const status = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
  const idleTitle = "Copy formatted";

  return <div className="response-copy" ref={rootRef}>
    <button type="button" className="copy-button" aria-label={label} title={state === "idle" ? idleTitle : status} onClick={() => void copyFormatted()}>
      {state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span aria-live="polite">{status}</span>
    </button>
    <button
      ref={menuButtonRef}
      type="button"
      className="copy-button response-copy-menu-trigger"
      aria-label="More copy options"
      title="More copy options"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-controls={menuOpen ? menuId : undefined}
      onClick={() => setMenuOpen((open) => !open)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {menuOpen ? <div id={menuId} className="response-copy-menu" role="menu" aria-label="Copy options" onKeyDown={onMenuKeyDown}>
      <button ref={plainItemRef} type="button" role="menuitem" className="response-copy-menu-item" tabIndex={-1} onClick={() => void copyPlain()}>
        Copy plain text
      </button>
    </div> : null}
  </div>;
}
