"use client";

import type { ReactNode } from "react";
import { useId } from "react";

export function SettingsSection({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <section className="settings-section">
    <h2>{title}</h2>
    <p>{description}</p>
    {children ? <div className="settings-fields">{children}</div> : null}
  </section>;
}

export function SettingsChoice<T extends string>({ label, hint, value, options, disabled, pending = false, onChange }: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  pending?: boolean;
  onChange: (value: T) => void;
}) {
  return <fieldset className="settings-choice" disabled={disabled}>
    <legend>{label}</legend>
    {hint ? <p>{hint}</p> : null}
    <div className="settings-choice-options" role="radiogroup" aria-label={label}>
      {options.map((option) => <button key={option.value} type="button" role="radio" aria-disabled={pending || undefined} aria-checked={value === option.value} tabIndex={value === option.value || (!options.some((item) => item.value === value) && option === options[0]) ? 0 : -1} onKeyDown={(event) => {
        const index = options.indexOf(option);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % options.length
          : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + options.length - 1) % options.length : null;
        if (next === null) return;
        event.preventDefault();
        if (pending) return;
        (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
        onChange(options[next].value);
      }} onClick={() => { if (!pending) onChange(option.value); }}>{option.label}</button>)}
    </div>
  </fieldset>;
}

export function SettingsTextField({ id, label, hint, value, maxLength, multiline = false, disabled, draft, onDraftChange, onCommit }: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  maxLength: number;
  multiline?: boolean;
  disabled?: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const describedBy = hint ? `${id}-hint` : undefined;
  const dirty = draft.trim() !== value.trim();
  function commit() {
    if (draft.trim() === value.trim()) return;
    onCommit(draft);
  }
  return <div className="settings-field">
    <label htmlFor={id}>{label}</label>
    {hint ? <p id={`${id}-hint`}>{hint}</p> : null}
    {multiline
      ? <textarea id={id} maxLength={maxLength} disabled={disabled} aria-describedby={describedBy} value={draft} onChange={(event) => onDraftChange(event.target.value)} />
      : <input id={id} maxLength={maxLength} disabled={disabled} aria-describedby={describedBy} value={draft} onChange={(event) => onDraftChange(event.target.value)} />}
    <button type="button" className="settings-save" disabled={disabled || !dirty} aria-label={`Save ${label}`} onClick={commit}>Save</button>
  </div>;
}

export function SettingsToggle({ label, hint, checked, disabled, onChange }: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return <div className="chat-settings-row">
    <div className="chat-settings-copy"><div className="chat-settings-label" id={`${id}-label`}>{label}</div><p className="chat-settings-detail" id={`${id}-hint`}>{hint}</p></div>
    <button type="button" className="chat-settings-switch" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
  </div>;
}
