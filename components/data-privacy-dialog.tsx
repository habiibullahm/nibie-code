"use client";

import { startTransition, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { deleteAllConversationsAction } from "@/app/actions/privacy";
import { DELETE_ALL_CONFIRMATION, isDeleteAllConfirmed } from "@/lib/privacy/confirmation";
import { SIGN_OUT_DESCRIPTION, SIGN_OUT_LABEL } from "@/lib/privacy/sign-out";

type Props = {
  preview: boolean;
  busy: boolean;
  onDeleted: () => void;
};

export function DataPrivacyPanel({ preview, busy, onDeleted }: Props) {
  const [phrase, setPhrase] = useState("");
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletePending = useRef(false);
  const [error, setError] = useState("");
  const confirmed = isDeleteAllConfirmed(phrase);
  const locked = preview || busy || deleting;

  async function exportConversations() {
    if (preview || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/account/export", { headers: { accept: "application/json" } });
      if (response.status === 401) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      if (!response.ok) {
        setError("Your conversations couldn't be exported. Please try again.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "nibie-export-v2.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Your conversations couldn't be exported. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  function deleteAll() {
    if (!confirmed || locked || deletePending.current) return;
    deletePending.current = true;
    setDeleting(true);
    setError("");
    startTransition(async () => {
      try {
        const result = await deleteAllConversationsAction(phrase.trim());
        if (result.error || result.deletedCount === undefined) {
          setError(result.error ?? "Conversations couldn't be deleted. Please try again.");
          return;
        }
        setPhrase("");
        onDeleted();
      } catch {
        setError("Conversations couldn't be deleted. Please try again.");
      } finally {
        deletePending.current = false;
        setDeleting(false);
      }
    });
  }

  return <div className="privacy-panel">
    {preview && <p className="privacy-note">These account actions are unavailable in the local preview.</p>}
    {error && <p className="privacy-error" role="alert">{error}</p>}

    <section className="privacy-section" aria-labelledby="privacy-export">
      <h3 id="privacy-export">Export conversations</h3>
      <p>Download your conversations and messages as JSON. The file includes titles, messages, timestamps, and each conversation’s selected model.</p>
      <button className="privacy-button" type="button" disabled={preview || exporting} onClick={exportConversations}>{exporting ? "Preparing export…" : "Export JSON"}</button>
    </section>

    <section className="privacy-section" aria-labelledby="privacy-delete">
      <h3 id="privacy-delete">Delete all conversations</h3>
      <p>This permanently deletes every conversation and message on your account. Your account and settings stay. This cannot be undone.</p>
      <label className="privacy-confirm" htmlFor="delete-all-confirmation">Type {DELETE_ALL_CONFIRMATION} to confirm
        <input id="delete-all-confirmation" value={phrase} autoComplete="off" spellCheck={false} disabled={preview} onChange={(event) => setPhrase(event.target.value)} />
      </label>
      <button className="privacy-button is-danger" type="button" disabled={!confirmed || locked} onClick={deleteAll}>{deleting ? "Deleting…" : "Delete all conversations"}</button>
      {busy && !preview && <p className="privacy-note">Wait until the current response finishes before deleting conversations.</p>}
    </section>

    <section className="privacy-section" aria-labelledby="privacy-sign-out">
      <h3 id="privacy-sign-out">{SIGN_OUT_LABEL}</h3>
      <p>{SIGN_OUT_DESCRIPTION}</p>
      <form action={signOutAction}><button className="privacy-button" type="submit" disabled={preview}>{SIGN_OUT_LABEL}</button></form>
    </section>

    <section className="privacy-section" aria-labelledby="privacy-delete-account">
      <h3 id="privacy-delete-account">Delete account</h3>
      <p>Account deletion is not available yet. Signing out and deleting conversations do not remove your Nibie account.</p>
    </section>
  </div>;
}
