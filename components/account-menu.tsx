"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, CircleHelp, LogOut, Settings } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { changelogAnchorHref, changelogMenuLink, type WhatsNewPreview } from "@/lib/changelog";

type Props = {
  email: string;
  name: string;
  // Accepted so the sidebar keeps passing SIGN_OUT_LABEL. The menu button uses the shorter visible label.
  signOutLabel: string;
  onOpenSettings: () => void;
  compact?: boolean;
  releasePreview?: WhatsNewPreview | null;
};

// Long enough to cross the gap between the account row and the panel, short enough that leaving feels immediate.
const CLOSE_DELAY_MS = 100;
const LAST_SEEN_RELEASE_KEY = "nibie:last-seen-release";
const RELEASE_SEEN_EVENT = "nibie:release-seen";

function subscribeToReleaseSeen(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(RELEASE_SEEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RELEASE_SEEN_EVENT, onChange);
  };
}

function readLastSeenRelease() {
  try {
    return window.localStorage.getItem(LAST_SEEN_RELEASE_KEY);
  } catch {
    return null;
  }
}

export function AccountMenu({ email, name, onOpenSettings, compact = false, releasePreview = null }: Props) {
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
  const releaseSeenKey = releasePreview?.seenKey ?? null;
  const lastSeenRelease = useSyncExternalStore(subscribeToReleaseSeen, readLastSeenRelease, () => null);
  const releaseIsNew = Boolean(releaseSeenKey && lastSeenRelease !== releaseSeenKey);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const initial = (name || email).slice(0, 1).toUpperCase();

  const markReleaseSeen = useCallback(() => {
    if (!releaseSeenKey) return;
    try {
      window.localStorage.setItem(LAST_SEEN_RELEASE_KEY, releaseSeenKey);
      window.dispatchEvent(new Event(RELEASE_SEEN_EVENT));
    } catch {
      // The badge remains visible if this browser does not allow local storage.
    }
  }, [releaseSeenKey]);

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
      if (helpOpen) markReleaseSeen();
      setPinned(false);
      setSuppressHover(true);
      setHelpOpen(false);
      return;
    }
    setSuppressHover(false);
    setPinned(true);
  }

  const dismiss = useCallback((holdHover: boolean) => {
    if (helpOpen) markReleaseSeen();
    setPinned(false);
    setHovering(false);
    setSuppressHover(holdHover);
    setHelpOpen(false);
  }, [helpOpen, markReleaseSeen]);

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
    markReleaseSeen();
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
        markReleaseSeen();
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
  }, [open, helpOpen, dismiss, markReleaseSeen]);

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
        <button ref={helpButtonRef} type="button" className="account-menu-action" role="menuitem" aria-haspopup="menu" aria-expanded={helpOpen} aria-label="Help" onClick={openHelp} onKeyDown={onHelpKeyDown}><CircleHelp size={15} aria-hidden="true" />Help{releaseIsNew ? <span className="account-help-new" aria-hidden="true">New</span> : null}</button>
        {helpOpen && <div className="account-help-panel" role="menu" aria-label="Help">
          <p className="account-help-kicker">What’s new</p>
          {releasePreview ? <div className="account-help-release">
            <div className="account-help-release-meta">
              <div>
                <p className="account-help-release-version">{releasePreview.kind === "release" ? `Nibie ${releasePreview.version}` : "Latest updates"}</p>
                <p className="account-help-release-date">{releasePreview.kind === "release" ? releasePreview.date : "In progress"}</p>
              </div>
              {releaseIsNew ? <span className="account-help-new">New</span> : null}
            </div>
            {releasePreview.highlights.length ? <ul className="account-help-preview">
              {releasePreview.highlights.map((line) => <li key={line}>{line}</li>)}
            </ul> : null}
          </div> : <p className="account-help-empty">No updates yet.</p>}
          <a ref={helpLinkRef} className="account-menu-action" role="menuitem" href={updatesHref} aria-label="View full changelog" onClick={openUpdates}>
            View full changelog
            <ArrowRight size={13} aria-hidden="true" />
          </a>
        </div>}
      </div>
      <form action={signOutAction}><button className="account-menu-signout" type="submit" role="menuitem"><LogOut size={15} aria-hidden="true" />Sign out</button></form>
    </div>}
  </div>;
}
