"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { settingsSections, type SettingsSectionId } from "@/components/settings/registry";

export function SettingsMobileNavigation({ id, active, onNavigate }: { id: string; active: SettingsSectionId; onNavigate: (section: SettingsSectionId) => void }) {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const label = settingsSections.find((section) => section.id === active)!.label;

  useEffect(() => {
    if (expanded) navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, [expanded]);

  function collapse() {
    setExpanded(false);
    triggerRef.current?.focus();
  }

  return <div className="settings-mobile-nav" onKeyDown={(event) => {
    if (expanded && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      collapse();
    }
  }}>
    <span id={`${id}-section-label`}>Section</span>
    <button ref={triggerRef} type="button" className="settings-section-picker" aria-label={`Settings section: ${label}`} aria-expanded={expanded} aria-controls={`${id}-mobile-sections`} onClick={() => setExpanded(!expanded)} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setExpanded(true); }
    }}>{label}<ChevronDown size={16} aria-hidden="true" /></button>
    {expanded ? <nav ref={navRef} id={`${id}-mobile-sections`} className="settings-section-options" aria-labelledby={`${id}-section-label`}>
      {settingsSections.map((section, index) => <button key={section.id} type="button" aria-current={active === section.id ? "page" : undefined} onClick={() => { onNavigate(section.id); collapse(); }} onKeyDown={(event) => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? settingsSections.length - 1
          : event.key === "ArrowRight" ? (index + 1) % settingsSections.length
          : event.key === "ArrowLeft" ? (index + settingsSections.length - 1) % settingsSections.length
          : event.key === "ArrowDown" ? (index + 2) % settingsSections.length
          : event.key === "ArrowUp" ? (index + settingsSections.length - 2) % settingsSections.length : null;
        if (next === null) return;
        event.preventDefault();
        (navRef.current?.children[next] as HTMLElement)?.focus();
      }}>{section.label}</button>)}
    </nav> : null}
  </div>;
}
