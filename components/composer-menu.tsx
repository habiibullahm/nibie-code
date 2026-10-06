"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

export type MenuItem<T extends string> = { value: T; label: string; detail?: string };
type Props<T extends string> = {
  // Names the control for assistive tech, e.g. "Model" -> "Model: Balanced".
  name: string;
  value: T;
  items: MenuItem<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  description?: string;
  // Why the control is unavailable; shown as a tooltip and announced.
  disabledReason?: string;
};

// A small single-choice popover (menuitemradio) that opens above the composer. Keyboard: Enter/Space/Arrow opens, arrows move,
// Home/End jump, Enter/Space chooses, Escape closes and returns focus, Tab closes.
export function ComposerMenu<T extends string>({ name, value, items, onChange, disabled = false, disabledReason, description }: Props<T>) {
  const [openRequested, setOpen] = useState(false);
  // A menu cannot stay open on a control that has just become unavailable.
  const open = openRequested && !disabled;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = items.find((item) => item.value === value) ?? items[0];
  const currentLabel = current?.label ?? (value || "Unavailable");

  useEffect(() => {
    if (!open) return;
    itemRefs.current[Math.max(0, items.findIndex((item) => item.value === value))]?.focus();
    function closeOutside(event: PointerEvent) { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
    // Focus moves only when the menu opens; later value changes close it anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(returnFocus: boolean) { setOpen(false); if (returnFocus) buttonRef.current?.focus(); }
  function choose(next: T) { if (next !== value) onChange(next); close(true); }
  function openFromKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
  }
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const index = itemRefs.current.findIndex((element) => element === document.activeElement);
    const last = items.length - 1;
    const target = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index <= 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target >= 0) { event.preventDefault(); itemRefs.current[target]?.focus(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") setOpen(false);
  }

  return <div className="composer-menu" ref={rootRef}>
    <button ref={buttonRef} type="button" className="composer-menu-button" disabled={disabled} title={disabled ? disabledReason : description ? `Select ${name.toLowerCase()}` : undefined}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      aria-label={disabled && disabledReason ? `${name}: ${currentLabel} (${disabledReason})` : `${name}: ${currentLabel}`}
      onClick={() => setOpen((state) => !state)} onKeyDown={openFromKey}>
      <span>{currentLabel}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div id={menuId} className="composer-menu-list" role="menu" aria-label={description ? `Select ${name.toLowerCase()}` : name} onKeyDown={moveFocus}>
      {description ? <div className="composer-menu-heading" role="presentation"><strong>Select {name.toLowerCase()}</strong><small>{description}</small></div> : null}
      {items.map((item, index) => <button key={item.value} ref={(element) => { itemRefs.current[index] = element; }} type="button" role="menuitemradio" aria-checked={item.value === value} tabIndex={-1} className="composer-menu-item" onClick={() => choose(item.value)}>
        <span className="composer-menu-text"><span>{item.label}</span>{item.detail && <small>{item.detail}</small>}</span>
        {item.value === value && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
