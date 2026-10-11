"use client";

import { startTransition, useEffect, useId, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { getPreferencesAction, updatePreferencesAction } from "@/app/actions/preferences";
import { settingsSections, type SettingsSectionId } from "@/components/settings/registry";
import type { ModelOption } from "@/lib/chat/models";
import { parsePreferencePatch } from "@/lib/preferences/validation";
import type { PreferencePatch, UserPreferences } from "@/lib/preferences/types";

type Props = {
  initialSection?: SettingsSectionId;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  email: string;
  preview: boolean;
  busy?: boolean;
  models: ModelOption[];
  initialPreferences: UserPreferences;
  initialError: string | null;
  onClose: () => void;
  onSaved: (preferences: UserPreferences) => void;
  onConversationsDeleted?: () => void;
};

export function SettingsDialog({ initialSection = "general", fallbackFocusRef, email, preview, busy = false, models, initialPreferences, initialError, onClose, onSaved, onConversationsDeleted }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [loadError, setLoadError] = useState(initialError);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const active = settingsSections.find((item) => item.id === section) ?? settingsSections[0];

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const fallback = fallbackFocusRef?.current;
    // Native modal dialogs contain focus and make the rest of the page inert.
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      const target = matchMedia("(max-width: 640px)").matches
        ? dialog?.querySelector<HTMLElement>("select")
        : dialog?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']");
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else {
        (fallback?.getClientRects().length ? fallback : document.querySelector<HTMLElement>(".desktop-sidebar .account-settings"))?.focus();
      }
    };
  }, [fallbackFocusRef]);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    startTransition(async () => {
      try {
        const result = await getPreferencesAction();
        if (cancelled) return;
        setPreferences(result.preferences);
        setLoadError(result.error);
        if (!result.error) onSaved(result.preferences);
      } catch {
        if (!cancelled) setLoadError("Settings couldn't be loaded. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [preview, onSaved]);

  function change(patch: PreferencePatch) {
    if (savingRef.current || loading || loadError) return;
    const parsed = parsePreferencePatch(patch);
    if ("error" in parsed) { setSaveError(parsed.error); setStatus(""); return; }
    if (Object.entries(parsed.data).every(([key, value]) => preferences[key as keyof PreferencePatch] === value)) return;
    savingRef.current = true;
    setSaveError(null);
    setStatus("Saving…");
    setSaving(true);
    startTransition(async () => {
      try {
        const result = preview
          ? { preferences: { ...preferences, ...parsed.data, updatedAt: new Date().toISOString() }, error: null }
          : await updatePreferencesAction(parsed.data);
        if (result.error) { setSaveError(result.error); setStatus(""); return; }
        setPreferences(result.preferences);
        onSaved(result.preferences);
        setStatus("Saved");
      } catch {
        setSaveError("Your changes couldn't be saved. Try again.");
        setStatus("");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    });
  }

  function reload() {
    if (preview || loading) return;
    setLoading(true);
    startTransition(async () => {
      try {
        const result = await getPreferencesAction();
        setPreferences(result.preferences);
        setLoadError(result.error);
        if (!result.error) onSaved(result.preferences);
      } catch {
        setLoadError("Settings couldn't be loaded. Try again.");
      } finally {
        setLoading(false);
      }
    });
  }

  function navigate(next: SettingsSectionId) {
    setSection(next);
    contentRef.current?.scrollTo({ top: 0 });
  }

  const ActiveSection = active.Component;
  return <dialog ref={dialogRef} className="settings-dialog" aria-labelledby={`${id}-title`} onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    // Keep Tab in the dialog instead of taking an intermediate stop in browser chrome.
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <header className="settings-header">
      <h1 id={`${id}-title`}>Settings</h1>
      <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="settings-body">
      <nav className="settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
        {settingsSections.map((item, index) => <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-selected={item.id === active.id} aria-controls={`${id}-panel`} tabIndex={item.id === active.id ? 0 : -1} onClick={() => navigate(item.id)} onKeyDown={(event) => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? settingsSections.length - 1
            : event.key === "ArrowDown" ? (index + 1) % settingsSections.length
            : event.key === "ArrowUp" ? (index + settingsSections.length - 1) % settingsSections.length : null;
          if (next === null) return;
          event.preventDefault();
          navigate(settingsSections[next].id);
          document.getElementById(`${id}-tab-${settingsSections[next].id}`)?.focus();
        }}>{item.label}</button>)}
      </nav>
      <div className="settings-mobile-nav">
        <label htmlFor={`${id}-section`}>Section</label>
        <select id={`${id}-section`} aria-label="Settings section" value={active.id} onChange={(event) => navigate(event.target.value as SettingsSectionId)}>
          {settingsSections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <div ref={contentRef} className="settings-content" role="tabpanel" id={`${id}-panel`} aria-label={active.label} tabIndex={0}>
        <ActiveSection preferences={preferences} models={models} email={email} disabled={loading || saving || !!loadError} preview={preview} busy={busy} onChange={change} onConversationsDeleted={onConversationsDeleted} />
      </div>
    </div>
    <footer className="settings-feedback">
      {loadError ? <p className="settings-error" role="alert">{loadError}{preview ? null : <button type="button" disabled={loading} onClick={reload}>Try again</button>}</p> : null}
      {saveError ? <p className="settings-error" role="alert">{saveError}</p> : null}
      <p className="settings-status" role="status">{loading ? "Loading settings…" : status || (preview ? "Preview changes last for this visit." : "Changes save to your account unless marked for this device.")}</p>
    </footer>
  </dialog>;
}
