"use client";

import { useEffect, useRef } from "react";
import { settingsSections, type SettingsSectionId } from "@/components/settings/registry";

export function SettingsMobileNavigation({ id, active, onNavigate }: { id: string; active: SettingsSectionId; onNavigate: (section: SettingsSectionId) => void }) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const revealSelected = () => navRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    revealSelected();
    // Reveal the selected tab when resizing from desktop to the mobile layout.
    const observer = new ResizeObserver(revealSelected);
    if (navRef.current) observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [active]);

  return <nav ref={navRef} className="settings-mobile-nav" role="tablist" aria-label="Settings sections" aria-orientation="horizontal">
    {settingsSections.map((section, index) => <button key={section.id} type="button" role="tab" id={`${id}-mobile-tab-${section.id}`} aria-selected={active === section.id} aria-controls={`${id}-panel`} tabIndex={active === section.id ? 0 : -1} onClick={() => onNavigate(section.id)} onKeyDown={(event) => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? settingsSections.length - 1
        : event.key === "ArrowRight" ? (index + 1) % settingsSections.length
        : event.key === "ArrowLeft" ? (index + settingsSections.length - 1) % settingsSections.length : null;
      if (next === null) return;
      event.preventDefault();
      onNavigate(settingsSections[next].id);
      const target = navRef.current?.children[next] as HTMLElement | undefined;
      target?.focus({ preventScroll: true });
      // Keyboard navigation must also reveal an already-selected tab after a swipe.
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }}>{section.label}</button>)}
  </nav>;
}
