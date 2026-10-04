"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteWorkbenchDocumentAction, updateWorkbenchDocumentAction } from "@/app/actions/workbench";
import { useStableCallback } from "@/components/use-stable-callback";
import { workbenchPath } from "@/lib/routes";
import { beginWorkbenchSave, draftsMatch, editWorkbenchDraft, failWorkbenchSave, initialWorkbenchEditorState, isWorkbenchDirty, saveStatusLabel, succeedWorkbenchSave, type WorkbenchEditorState } from "@/lib/workbench/save-state";
import { workbenchAutosaveMs, workbenchContentLimit, workbenchTitleLimit, type WorkbenchDocument } from "@/lib/workbench/types";
import { parseWorkbenchWrite } from "@/lib/workbench/validation";

const saveFailed = "We couldn't save that document. Please try again.";

export function WorkbenchEditor({ document, roomName }: { document: WorkbenchDocument; roomName: string | null }) {
  const router = useRouter();
  const documentId = document.id;
  const [state, setState] = useState<WorkbenchEditorState>(() => initialWorkbenchEditorState({ title: document.title, content: document.content }));
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const stateRef = useRef(state);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const mountedRef = useRef(true);

  function update(reducer: (latest: WorkbenchEditorState) => WorkbenchEditorState) {
    const next = reducer(stateRef.current);
    stateRef.current = next;
    if (mountedRef.current) setState(next);
    return next;
  }

  const persist = useStableCallback(async () => {
    if (savingRef.current || deletingRef.current) return;
    const current = stateRef.current;
    if (!isWorkbenchDirty(current)) return;
    const parsed = parseWorkbenchWrite(current.draft);
    if ("error" in parsed) {
      update((latest) => failWorkbenchSave(latest, parsed.error));
      return;
    }
    const payload = parsed.data;
    const snapshot = current.draft;
    savingRef.current = true;
    update((latest) => beginWorkbenchSave(latest));
    let failed = false;
    try {
      const result = await updateWorkbenchDocumentAction(documentId, payload);
      if (result.error || !result.data) {
        failed = true;
        update((latest) => failWorkbenchSave(latest, result.error ?? saveFailed));
        return;
      }
      const saved = { title: result.data.title, content: result.data.content };
      update((latest) => {
        const next = succeedWorkbenchSave(latest, saved);
        return draftsMatch(latest.draft, snapshot) ? { ...next, draft: { ...saved } } : next;
      });
    } finally {
      savingRef.current = false;
      if (!failed && !deletingRef.current && isWorkbenchDirty(stateRef.current)) void persist();
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    if (state.phase === "saving" || state.phase === "failed" || !isWorkbenchDirty(state)) return;
    const handle = window.setTimeout(() => { void persist(); }, workbenchAutosaveMs);
    return () => window.clearTimeout(handle);
  }, [persist, state]);

  useEffect(() => {
    function flush() { void persist(); }
    window.addEventListener("pagehide", flush);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [persist]);

  function changeDraft(patch: Partial<WorkbenchEditorState["draft"]>) {
    update((latest) => {
      const next = editWorkbenchDraft(latest, { ...latest.draft, ...patch });
      return next.phase === "failed" ? { ...next, phase: "saved", detail: null } : next;
    });
  }

  function handleBlur() {
    void persist();
  }

  async function remove() {
    if (deletingRef.current) return;
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    deletingRef.current = true;
    setDeleting(true);
    const result = await deleteWorkbenchDocumentAction(documentId);
    if (result.error) {
      deletingRef.current = false;
      setDeleteError(result.error);
      setDeleting(false);
      return;
    }
    router.push(workbenchPath);
    router.refresh();
  }

  const label = saveStatusLabel(state);

  return <main className="workbench-shell">
    <header className="workbench-top">
      <Link className="workbench-back" href={workbenchPath}>Documents</Link>
      <p className={`workbench-status${state.phase === "failed" || deleteError ? " is-failed" : ""}`} role="status">{deleteError || label}{!deleteError && state.phase === "failed" && state.detail ? ` · ${state.detail}` : ""}{!deleteError && state.phase === "failed" ? <button type="button" onClick={() => void persist()}>Retry</button> : null}</p>
      <button type="button" className="workbench-delete" disabled={deleting} onClick={() => void remove()}>{deleting ? "Deleting…" : "Delete"}</button>
    </header>
    <form className="workbench-stage" onSubmit={(event) => event.preventDefault()} onBlur={handleBlur}>
      {roomName ? <p className="workbench-room">Room · {roomName}</p> : null}
      <input className="workbench-title" aria-label="Document title" autoComplete="off" value={state.draft.title} maxLength={workbenchTitleLimit} onChange={(event) => changeDraft({ title: event.target.value })} />
      <textarea className="workbench-body" aria-label="Document" value={state.draft.content} maxLength={workbenchContentLimit} onChange={(event) => changeDraft({ content: event.target.value })} />
    </form>
  </main>;
}
