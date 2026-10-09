"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Expand, Trash2, WandSparkles, X } from "lucide-react";
import {
  applyWorkbenchSuggestionAction,
  deleteWorkbenchDocumentAction,
  updateWorkbenchDocumentAction,
} from "@/app/actions/workbench";
import { WorkbenchAiRevision } from "@/components/workbench-ai-revision";
import { useStableCallback } from "@/components/use-stable-callback";
import { workbenchDocumentPath, workbenchPath } from "@/lib/routes";
import {
  beginWorkbenchAiGenerate,
  cancelWorkbenchAi,
  closeWorkbenchAiPrompt,
  completeWorkbenchAiProposal,
  discardWorkbenchAiProposal,
  failWorkbenchAi,
  initialWorkbenchAiState,
  openWorkbenchAiPrompt,
  setWorkbenchAiInstruction,
  type WorkbenchAiState,
} from "@/lib/workbench/revision";
import {
  beginWorkbenchSave,
  conflictWorkbenchSave,
  draftsMatch,
  editWorkbenchDraft,
  failWorkbenchSave,
  initialWorkbenchEditorState,
  isWorkbenchDirty,
  replaceWorkbenchFromServer,
  saveStatusLabel,
  succeedWorkbenchSave,
  type WorkbenchEditorState,
} from "@/lib/workbench/save-state";
import { workbenchAutosaveMs, workbenchContentLimit, workbenchTitleLimit, type WorkbenchDocument } from "@/lib/workbench/types";
import { parseWorkbenchWrite } from "@/lib/workbench/validation";

const saveFailed = "We couldn't save that document. Please try again.";

type Variant = "page" | "panel";

type Props = {
  document: WorkbenchDocument;
  roomName?: string | null;
  variant?: Variant;
  onClose?: () => void;
};

async function readSse(response: Response, signal: AbortSignal, onEvent: (type: string, data: unknown) => void) {
  if (!response.body) throw new Error(saveFailed);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (!payload) continue;
        onEvent(eventName, JSON.parse(payload) as unknown);
        eventName = "message";
      }
    }
    if (done) break;
  }
}

export function WorkbenchEditor({ document, roomName = null, variant = "page", onClose }: Props) {
  const router = useRouter();
  const documentId = document.id;
  const [state, setState] = useState<WorkbenchEditorState>(() =>
    initialWorkbenchEditorState({ title: document.title, content: document.content }, document.revision ?? 1),
  );
  const [ai, setAi] = useState<WorkbenchAiState>(() => initialWorkbenchAiState());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [applying, setApplying] = useState(false);
  const stateRef = useRef(state);
  const aiRef = useRef(ai);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const mountedRef = useRef(true);
  const reviseAbortRef = useRef<AbortController | null>(null);

  function update(reducer: (latest: WorkbenchEditorState) => WorkbenchEditorState) {
    const next = reducer(stateRef.current);
    stateRef.current = next;
    if (mountedRef.current) setState(next);
    return next;
  }

  function updateAi(reducer: (latest: WorkbenchAiState) => WorkbenchAiState) {
    const next = reducer(aiRef.current);
    aiRef.current = next;
    if (mountedRef.current) setAi(next);
    return next;
  }

  const persist = useStableCallback(async () => {
    if (savingRef.current || deletingRef.current) return;
    if (aiRef.current.phase === "generating" || aiRef.current.phase === "review") return;
    const current = stateRef.current;
    if (!isWorkbenchDirty(current) || current.phase === "conflict") return;
    const parsed = parseWorkbenchWrite({ ...current.draft, expectedRevision: current.revision });
    if ("error" in parsed) {
      update((latest) => failWorkbenchSave(latest, parsed.error));
      return;
    }
    const snapshot = current.draft;
    const expectedRevision = current.revision;
    savingRef.current = true;
    update((latest) => beginWorkbenchSave(latest));
    let failed = false;
    try {
      const result = await updateWorkbenchDocumentAction(documentId, parsed.data);
      if (result.conflict) {
        failed = true;
        update((latest) => conflictWorkbenchSave(latest, result.error));
        return;
      }
      if (result.error || !result.data) {
        failed = true;
        update((latest) => failWorkbenchSave(latest, result.error ?? saveFailed));
        return;
      }
      const saved = { title: result.data.title, content: result.data.content };
      update((latest) => {
        const next = succeedWorkbenchSave(latest, saved, result.data!.revision);
        return draftsMatch(latest.draft, snapshot) ? { ...next, draft: { ...saved } } : next;
      });
      if (expectedRevision !== result.data.revision - 1 && !draftsMatch(stateRef.current.draft, snapshot)) {
        // Local draft moved on; keep it and let the next persist use the new revision.
      }
    } finally {
      savingRef.current = false;
      if (!failed && !deletingRef.current && isWorkbenchDirty(stateRef.current) && stateRef.current.phase !== "conflict") {
        void persist();
      }
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    if (state.phase === "saving" || state.phase === "failed" || state.phase === "conflict" || !isWorkbenchDirty(state)) return;
    if (ai.phase === "generating" || ai.phase === "review") return;
    const handle = window.setTimeout(() => { void persist(); }, workbenchAutosaveMs);
    return () => window.clearTimeout(handle);
  }, [persist, state, ai.phase]);

  useEffect(() => {
    function flush() { void persist(); }
    window.addEventListener("pagehide", flush);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", flush);
      reviseAbortRef.current?.abort();
      flush();
    };
  }, [persist]);

  function changeDraft(patch: Partial<WorkbenchEditorState["draft"]>) {
    if (aiRef.current.phase === "generating" || aiRef.current.phase === "review") return;
    update((latest) => {
      const next = editWorkbenchDraft(latest, { ...latest.draft, ...patch });
      if (next.phase === "failed") return { ...next, phase: "saved", detail: null };
      return next;
    });
  }

  function handleBlur() {
    void persist();
  }

  async function ensureSaved(): Promise<boolean> {
    if (stateRef.current.phase === "conflict") return false;
    if (!isWorkbenchDirty(stateRef.current)) return true;
    await persist();
    return !isWorkbenchDirty(stateRef.current) && stateRef.current.phase === "saved";
  }

  const generateSuggestion = useStableCallback(async (instructionOverride?: string) => {
    if (reviseAbortRef.current) reviseAbortRef.current.abort();
    const instruction = (instructionOverride ?? aiRef.current.instruction).trim();
    if (!instruction) {
      updateAi((latest) => failWorkbenchAi(latest, "Describe how Nibie should improve this document."));
      return;
    }
    updateAi((latest) => setWorkbenchAiInstruction(latest, instruction));
    const ready = await ensureSaved();
    if (!ready) {
      updateAi((latest) => failWorkbenchAi(latest, stateRef.current.detail ?? "Save the document before generating a suggestion."));
      return;
    }
    const current = stateRef.current;
    const aborter = new AbortController();
    reviseAbortRef.current = aborter;
    const placeholderRunId = "pending";
    updateAi((latest) => beginWorkbenchAiGenerate(latest, {
      original: { ...current.persisted },
      expectedRevision: current.revision,
      runId: placeholderRunId,
    }));
    try {
      const response = await fetch("/api/workbench/revise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: aborter.signal,
        body: JSON.stringify({
          documentId,
          expectedRevision: current.revision,
          instruction,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        updateAi((latest) => failWorkbenchAi(latest, payload?.error ?? saveFailed));
        return;
      }
      await readSse(response, aborter.signal, (type, data) => {
        const payload = data as {
          runId?: string;
          suggestion?: { title: string; content: string };
          error?: string;
        };
        if (type === "start" && payload.runId) {
          updateAi((latest) => ({ ...latest, runId: payload.runId! }));
        }
        if (type === "complete" && payload.suggestion) {
          updateAi((latest) => completeWorkbenchAiProposal(latest, payload.suggestion!));
        }
        if (type === "error") {
          updateAi((latest) => failWorkbenchAi(latest, payload.error ?? saveFailed));
        }
        if (type === "cancelled") {
          updateAi((latest) => cancelWorkbenchAi(latest));
        }
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updateAi((latest) => cancelWorkbenchAi(latest));
        return;
      }
      updateAi((latest) => failWorkbenchAi(latest, saveFailed));
    } finally {
      if (reviseAbortRef.current === aborter) reviseAbortRef.current = null;
    }
  });

  async function applySuggestion() {
    const currentAi = aiRef.current;
    if (currentAi.phase !== "review" || !currentAi.suggestion || !currentAi.runId || currentAi.expectedRevision == null) return;
    setApplying(true);
    try {
      const result = await applyWorkbenchSuggestionAction({
        documentId,
        runId: currentAi.runId,
        title: currentAi.suggestion.title,
        content: currentAi.suggestion.content,
        expectedRevision: currentAi.expectedRevision,
      });
      if (result.conflict) {
        update((latest) => conflictWorkbenchSave(latest, result.error));
        updateAi(() => discardWorkbenchAiProposal());
        return;
      }
      if (result.error || !result.data) {
        updateAi((latest) => failWorkbenchAi(latest, result.error ?? saveFailed));
        return;
      }
      update(() => replaceWorkbenchFromServer(
        stateRef.current,
        { title: result.data!.title, content: result.data!.content },
        result.data!.revision,
      ));
      updateAi(() => discardWorkbenchAiProposal());
    } finally {
      setApplying(false);
    }
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
    if (variant === "panel") {
      onClose?.();
      return;
    }
    router.push(workbenchPath);
    router.refresh();
  }

  const label = saveStatusLabel(state);
  const editingLocked = ai.phase === "generating" || ai.phase === "review";
  const statusClass = `workbench-status${state.phase === "failed" || state.phase === "conflict" || deleteError ? " is-failed" : ""}`;
  const statusDetail = <>
    {deleteError || label}
    {!deleteError && state.phase === "failed" && state.detail ? ` · ${state.detail}` : ""}
    {!deleteError && state.phase === "conflict" && state.detail ? ` · ${state.detail}` : ""}
    {!deleteError && state.phase === "failed" ? <button type="button" onClick={() => void persist()}>Retry</button> : null}
  </>;
  const headerActions = <>
    <button type="button" className="icon-button" aria-label="AI Assist" title="AI Assist" disabled={editingLocked || state.phase === "conflict"} onClick={() => updateAi((latest) => openWorkbenchAiPrompt(latest))}>
      <WandSparkles size={16} aria-hidden="true" />
    </button>
    {variant === "panel" ? <a className="icon-button" href={workbenchDocumentPath(documentId)} aria-label="Expand" title="Expand"><Expand size={16} aria-hidden="true" /></a> : null}
    {variant === "panel" ? <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button> : null}
    {variant === "page" ? <button type="button" className="workbench-delete" aria-label={deleting ? "Deleting document" : "Delete document"} title={deleting ? "Deleting document" : "Delete document"} disabled={deleting} onClick={() => void remove()}><Trash2 size={16} aria-hidden="true" /></button> : null}
  </>;

  const body = <>
    <WorkbenchAiRevision
      state={ai}
      busy={applying}
      onInstructionChange={(value) => updateAi((latest) => setWorkbenchAiInstruction(latest, value))}
      onGenerate={() => void generateSuggestion()}
      onStop={() => reviseAbortRef.current?.abort()}
      onApply={() => void applySuggestion()}
      onDiscard={() => updateAi(() => discardWorkbenchAiProposal())}
      onClosePrompt={() => updateAi((latest) => closeWorkbenchAiPrompt(latest))}
    />
    <form className="workbench-stage" onSubmit={(event) => event.preventDefault()} onBlur={handleBlur}>
      {roomName && variant === "page" ? <p className="workbench-room">Room · {roomName}</p> : null}
      <input className="workbench-title" aria-label="Document title" autoComplete="off" value={state.draft.title} maxLength={workbenchTitleLimit} disabled={editingLocked} onChange={(event) => changeDraft({ title: event.target.value })} />
      <textarea className="workbench-body" aria-label="Document" value={state.draft.content} maxLength={workbenchContentLimit} disabled={editingLocked} onChange={(event) => changeDraft({ content: event.target.value })} />
    </form>
  </>;

  if (variant === "panel") {
    return <div className="workbench-panel-editor">
      <header className="workbench-panel-top">
        <p className={statusClass} role="status">{statusDetail}</p>
        <div className="workbench-panel-actions">{headerActions}</div>
      </header>
      {body}
    </div>;
  }

  return <main className="workbench-shell">
    <header className="workbench-top">
      <Link className="workbench-back" href={workbenchPath} aria-label="Back to documents" title="Back to documents"><ArrowLeft size={16} aria-hidden="true" /></Link>
      <p className={statusClass} role="status">{statusDetail}</p>
      <div className="workbench-top-actions">{headerActions}</div>
    </header>
    {body}
  </main>;
}
