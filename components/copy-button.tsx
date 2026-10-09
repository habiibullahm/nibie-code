"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
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
  /** Icon + tooltip/aria only — used on assistant message action rows. */
  iconOnly?: boolean;
};

/**
 * Single reply copy control: writes Word-safe formatted HTML + plain text.
 * Code-block CopyButton stays unchanged.
 */
export function ResponseCopyButton({ markdown, sources, label = "Copy response", iconOnly = false }: ResponseCopyProps) {
  const { state, report } = useCopyFeedback();

  async function copy() {
    try {
      const { html, plain } = markdownToClipboard(markdown, sources);
      await writeFormattedClipboard(html, plain);
      report("copied");
    } catch {
      report("failed");
    }
  }

  const status = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
  const iconSize = iconOnly ? 14 : 13;

  return <button type="button" className={`copy-button${iconOnly ? " is-icon-only" : ""}`} aria-label={label} title={state === "idle" ? label : status} onClick={() => void copy()}>
    {state === "copied" ? <Check size={iconSize} aria-hidden="true" /> : <Copy size={iconSize} aria-hidden="true" />}
    <span className={iconOnly ? "visually-hidden" : undefined} aria-live="polite">{iconOnly && state === "idle" ? "" : status}</span>
  </button>;
}
