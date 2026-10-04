"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, CircleHelp, LogOut, Settings } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { changelogAnchorHref, changelogMenuLink, changelogPreview } from "@/lib/changelog";

type Props = {
  email: string;
  name: string;
  // Accepted so the sidebar keeps passing SIGN_OUT_LABEL. The menu button uses the shorter visible label.
  signOutLabel: string;
  onOpenSettings: () => void;
  compact?: boolean;
};

// Long enough to cross the gap between the account row and the panel, short enough that leaving feels immediate.
const CLOSE_DELAY_MS = 100;

export function AccountMenu({ email, name, onOpenSettings, compact = false }: Props) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpLinkRef = useRef<HTMLAnchorElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  // A click or Escape that closes the menu should stay closed while the pointer is still on the trigger.
  const [suppressHover, setSuppressHover] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const open = pinned || (hovering && !suppressHover);
  const updatesHref = changelogAnchorHref(process.env.NEXT_PUBLIC_APP_URL);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const initial = (name || email).slice(0, 1).toUpperCase();

  function clearCloseTimer() {
    if (closeTimer.current == null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function pointerEnter() {
    clearCloseTimer();
    setHovering(true);
  }

  function pointerLeave() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      setHovering(false);
      setSuppressHover(false);
      setHelpOpen(false);
    }, CLOSE_DELAY_MS);
  }

  function toggle() {
    if (pinned) {
      setPinned(false);
      setSuppressHover(true);
      setHelpOpen(false);
      return;
    }
    setSuppressHover(false);
    setPinned(true);
  }

  function dismiss(holdHover: boolean) {
    setPinned(false);
    setHovering(false);
    setSuppressHover(holdHover);
    setHelpOpen(false);
  }

  function openHelp() {
    setHelpOpen(true);
    requestAnimationFrame(() => helpLinkRef.current?.focus());
  }

  function openSettings() {
    dismiss(true);
    onOpenSettings();
  }

  function focusMenuItem(direction: 1 | -1 | "first" | "last") {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const index = direction === "first" ? 0
      : direction === "last" ? items.length - 1
      : current < 0 ? (direction === 1 ? 0 : items.length - 1)
      : (current + direction + items.length) % items.length;
    items[index]?.focus();
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const target = event.key === "ArrowUp" ? "last" : "first";
    if (open) {
      focusMenuItem(target);
      return;
    }
    pendingFocus.current = target;
    setSuppressHover(false);
    setPinned(true);
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); focusMenuItem(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusMenuItem(-1); }
    else if (event.key === "Home") { event.preventDefault(); focusMenuItem("first"); }
    else if (event.key === "End") { event.preventDefault(); focusMenuItem("last"); }
    else if (event.key === "ArrowRight" && document.activeElement === helpButtonRef.current) {
      event.preventDefault();
      openHelp();
    }
  }

  function onHelpKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openHelp();
  }

  function openUpdates(event: React.MouseEvent<HTMLAnchorElement>) {
    const link = changelogMenuLink(process.env.NEXT_PUBLIC_APP_URL, window.location.origin);
    if (!link.external) return;
    event.preventDefault();
    window.open(link.href, "_blank", "noopener,noreferrer");
    dismiss(true);
  }

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    const items = rootRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
    if (!items?.length) return;
    (target === "last" ? items[items.length - 1] : items[0]).focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) dismiss(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (helpOpen) {
        setHelpOpen(false);
        helpButtonRef.current?.focus();
        return;
      }
      dismiss(true);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, helpOpen]);

  return <div className={`account-menu${compact ? " is-compact" : ""}`} ref={rootRef} onPointerEnter={pointerEnter} onPointerLeave={pointerLeave}>
    <button ref={triggerRef} type="button" className="account-profile" aria-label={compact ? "Account" : undefined} title={compact ? "Account" : undefined} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={toggle} onKeyDown={onTriggerKeyDown}>
      <span className="avatar" aria-hidden="true">{initial || "?"}</span>
      <span className="account-copy">
        <span className="account-name">{name}</span>
        <span className="account-email" title={email}>{email}</span>
      </span>
    </button>
    {open && <div id={menuId} className="account-menu-panel" role="menu" aria-label="Account" onKeyDown={onMenuKeyDown}>
      <p className="account-menu-kicker">Signed in as</p>
      <p className="account-menu-identity">{email}</p>
      <button type="button" className="account-menu-action" role="menuitem" onClick={openSettings}><Settings size={15} aria-hidden="true" />Settings</button>
      <div className="account-help" onPointerEnter={() => setHelpOpen(true)} onPointerLeave={() => setHelpOpen(false)}>
        <button ref={helpButtonRef} type="button" className="account-menu-action" role="menuitem" aria-haspopup="menu" aria-expanded={helpOpen} aria-label="Help" onClick={openHelp} onKeyDown={onHelpKeyDown}><CircleHelp size={15} aria-hidden="true" />Help</button>
        {helpOpen && <div className="account-help-panel" role="menu" aria-label="Help">
          <p className="account-help-kicker">What&apos;s new</p>
          <ul className="account-help-preview">
            {changelogPreview.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <a ref={helpLinkRef} className="account-menu-action" role="menuitem" href={updatesHref} aria-label="View Nibie updates" onClick={openUpdates}>
            Full changelog
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </div>}
      </div>
      <form action={signOutAction}><button className="account-menu-signout" type="submit" role="menuitem"><LogOut size={15} aria-hidden="true" />Sign out</button></form>
    </div>}
  </div>;
}
