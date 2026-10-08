"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ComposerMenu, type MenuItem } from "@/components/composer-menu";
import {
  CHAT_ROLES,
  chatRoleDetails,
  chatRoleDisclaimer,
  chatRoleLabels,
  customInstructionsLimit,
  type ChatRole,
} from "@/lib/chat-roles/types";

type Props = {
  role: ChatRole;
  instructions: string | null;
  disabled?: boolean;
  disabledReason?: string;
  saving?: boolean;
  onRoleChange: (role: ChatRole) => void;
  onInstructionsSave: (instructions: string | null) => void;
  /** Persist general + cleared instructions in one operation (avoids busy-flag races). */
  onReset: () => void;
};

const roleItems: MenuItem<ChatRole>[] = CHAT_ROLES.map((value) => ({
  value,
  label: chatRoleLabels[value],
  detail: chatRoleDetails[value],
}));

export function ChatRoleControls({
  role,
  instructions,
  disabled = false,
  disabledReason,
  saving = false,
  onRoleChange,
  onInstructionsSave,
  onReset,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(instructions ?? "");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function openEditor() {
    setDraft(instructions ?? "");
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function save() {
    const next = draft.trim() || null;
    onInstructionsSave(next);
    close();
  }

  function reset() {
    setDraft("");
    onReset();
    close();
  }

  const busy = disabled || saving;
  const hasInstructions = Boolean(instructions?.trim());

  return (
    <div className="chat-role-controls">
      <ComposerMenu
        name="Role"
        description="Choose a Chat role for this conversation. Soft guidance only."
        value={role}
        items={roleItems}
        onChange={onRoleChange}
        disabled={busy}
        disabledReason={disabledReason ?? (saving ? "Saving…" : "A response is running")}
        emphasizedValue="custom"
      />
      <button
        type="button"
        className={`composer-menu-button chat-role-instructions-button${hasInstructions || role === "custom" ? " is-emphasized" : ""}`}
        disabled={busy}
        title="Chat instructions"
        aria-label={hasInstructions ? "Edit chat instructions" : "Add chat instructions"}
        onClick={openEditor}
      >
        <span>{hasInstructions ? "Instructions" : "Instructions…"}</span>
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          className="room-setup-dialog chat-role-instructions-dialog"
          aria-labelledby={titleId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <header className="settings-header">
            <h1 id={titleId}>Chat instructions</h1>
            <button type="button" className="icon-button" aria-label="Close chat instructions" onClick={close}>
              ×
            </button>
          </header>
          <form
            className="room-setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <p className="chat-role-disclaimer">{chatRoleDisclaimer}</p>
            <label className="room-field">
              <span>Custom instructions (optional)</span>
              <textarea
                value={draft}
                maxLength={customInstructionsLimit}
                rows={5}
                placeholder="Optional guidance for this conversation only…"
                onChange={(event) => setDraft(event.target.value)}
              />
              <small>
                {[...draft].length}/{customInstructionsLimit}
              </small>
            </label>
            <div className="room-setup-actions">
              <button type="button" className="privacy-button" onClick={reset}>
                Reset
              </button>
              <button type="button" className="privacy-button" onClick={close}>
                Cancel
              </button>
              <button type="submit" className="privacy-button">
                Save
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
