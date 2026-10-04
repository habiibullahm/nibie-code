"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy failed.");
}

// iconOnly shows just the icon (a check once copied); the label stays the accessible name and tooltip, and the
// result is still announced to screen readers.
export function CopyButton({ text, label, compact = false, iconOnly = false }: { text: string; label: string; compact?: boolean; iconOnly?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try { await writeClipboard(text); setState("copied"); }
    catch { setState("failed"); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  const status = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
  return <button type="button" className={`copy-button${compact ? " is-compact" : ""}${iconOnly ? " is-icon-only" : ""}`} aria-label={label} title={state === "idle" ? label : status} onClick={() => void copy()}>
    {state === "copied" ? <Check size={iconOnly ? 14 : 13} aria-hidden="true" /> : <Copy size={iconOnly ? 14 : 13} aria-hidden="true" />}
    <span className={iconOnly ? "visually-hidden" : undefined} aria-live="polite">{iconOnly && state === "idle" ? "" : status}</span>
  </button>;
}
