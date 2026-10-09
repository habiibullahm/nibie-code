"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Expand, MoreHorizontal, Trash2, X } from "lucide-react";
import {
  applyWorkbenchSuggestionAction,
  deleteWorkbenchDocumentAction,
  updateWorkbenchDocumentAction,
} from "@/app/actions/workbench";
import { MessageMarkdown } from "@/components/message-markdown";
import { WorkbenchAskNibie } from "@/components/workbench-ask-nibie";
import { useStableCallback } from "@/components/use-stable-callback";
import { workbenchDocumentPath, workbenchPath } from "@/lib/routes";
import {
  beginWorkbenchAiGenerate,
  cancelWorkbenchAi,
  closeWorkbenchAiPrompt,
  completeWorkbenchAiEdit,
  discardWorkbenchAiProposal,
  failWorkbenchAi,
  finishWorkbenchAiInlineEdit,
  initialWorkbenchAiState,
  isWorkbenchAiEditReady,
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
type EditorMode = "write" | "preview";
type SelectionSpan = { start: number; end: number; text: string };

type Props = {
  document: WorkbenchDocument;
  roomName?: string | null;
  variant?: Variant;
  onClose?: () => void;
  initialMode?: EditorMode;
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

export function WorkbenchEditor({ document, roomName = null, variant = "page", onClose, initialMode = "write" }: Props) {
  const router = useRouter();
  const documentId = document.id;
  const [state, setState] = useState<WorkbenchEditorState>(() =>
    initialWorkbenchEditorState({ title: document.title, content: document.content }, document.revision ?? 1),
  );
  const [ai, setAi] = useState<WorkbenchAiState>(() => initialWorkbenchAiState());
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [selection, setSelection] = useState<SelectionSpan | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const stateRef = useRef(state);
  const aiRef = useRef(ai);
  const selectionRef = useRef<SelectionSpan | null>(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const mountedRef = useRef(true);
  const reviseAbortRef = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuId = useId();

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

  function rememberSelection(next: SelectionSpan | null) {
    selectionRef.current = next;
    if (mountedRef.current) setSelection(next);
  }

  function captureSelectionFromTextarea(element: HTMLTextAreaElement) {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
      // Keep the last non-empty span while Ask Nibie is open so the click does not clear it.
      if (aiRef.current.phase === "idle") rememberSelection(null);
      return;
    }
    rememberSelection({ start, end, text: element.value.slice(start, end) });
  }

  function syncSelectionToContent(content: string) {
    const current = selectionRef.current;
    if (!current) return;
    if (current.end > content.length || content.slice(current.start, current.end) !== current.text) {
      rememberSelection(null);
    }
  }

  const persist = useStableCallback(async () => {
    if (savingRef.current || deletingRef.current) return;
    if (aiRef.current.phase === "generating" || aiRef.current.phase === "applying") return;
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
    if (ai.phase === "generating" || ai.phase === "applying") return;
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

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node) && !menuTriggerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setMenuPos(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        setMenuPos(null);
        menuTriggerRef.current?.focus();
      }
    }
    const handle = window.setTimeout(() => {
      globalThis.document.addEventListener("pointerdown", onPointerDown);
      globalThis.document.addEventListener("keydown", onKeyDown);
    }, 0);
    return () => {
      window.clearTimeout(handle);
      globalThis.document.removeEventListener("pointerdown", onPointerDown);
      globalThis.document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function toggleActionsMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      setMenuPos(null);
      return;
    }
    const box = menuTriggerRef.current?.getBoundingClientRect();
    if (box) {
      setMenuPos({ top: box.bottom + 4, right: Math.max(8, window.innerWidth - box.right) });
    }
    setMenuOpen(true);
  }

  function changeDraft(patch: Partial<WorkbenchEditorState["draft"]>) {
    if (aiRef.current.phase === "generating" || aiRef.current.phase === "applying") return;
    update((latest) => {
      const next = editWorkbenchDraft(latest, { ...latest.draft, ...patch });
      if (next.phase === "failed") return { ...next, phase: "saved", detail: null };
      return next;
    });
    if (patch.content != null) syncSelectionToContent(patch.content);
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

  const applyInlineEdit = useStableCallback(async () => {
    const currentAi = aiRef.current;
    if (!isWorkbenchAiEditReady(currentAi) || !currentAi.suggestion || !currentAi.runId || currentAi.expectedRevision == null) return;
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
    rememberSelection(null);
    updateAi((latest) => finishWorkbenchAiInlineEdit(latest));
  });

  const runSelectionEdit = useStableCallback(async () => {
    if (reviseAbortRef.current) reviseAbortRef.current.abort();
    const instruction = aiRef.current.instruction.trim();
    const span = selectionRef.current;
    if (!instruction) {
      updateAi((latest) => failWorkbenchAi(latest, "Describe how Nibie should change the selection."));
      return;
    }
    if (!span || !span.text) {
      updateAi((latest) => failWorkbenchAi(latest, "Select text in the document to Ask Nibie."));
      return;
    }
    updateAi((latest) => setWorkbenchAiInstruction(latest, instruction));
    const ready = await ensureSaved();
    if (!ready) {
      updateAi((latest) => failWorkbenchAi(latest, stateRef.current.detail ?? "Save the document before asking Nibie."));
      return;
    }
    const current = stateRef.current;
    if (current.draft.content.slice(span.start, span.end) !== span.text) {
      updateAi((latest) => failWorkbenchAi(latest, "That selection is out of date. Select the text again."));
      return;
    }
    const aborter = new AbortController();
    reviseAbortRef.current = aborter;
    updateAi((latest) => beginWorkbenchAiGenerate(latest, {
      original: { ...current.persisted },
      expectedRevision: current.revision,
      runId: "pending",
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
          selection: span,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        updateAi((latest) => failWorkbenchAi(latest, payload?.error ?? saveFailed));
        return;
      }
      let completed = false;
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
          completed = true;
          updateAi((latest) => completeWorkbenchAiEdit(latest, payload.suggestion!));
        }
        if (type === "error") {
          updateAi((latest) => failWorkbenchAi(latest, payload.error ?? saveFailed));
        }
        if (type === "cancelled") {
          updateAi((latest) => cancelWorkbenchAi(latest));
        }
      });
      if (completed && isWorkbenchAiEditReady(aiRef.current)) {
        await applyInlineEdit();
      }
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
  const editingLocked = ai.phase === "generating" || ai.phase === "applying";
  const statusClass = `workbench-status${state.phase === "failed" || state.phase === "conflict" || deleteError ? " is-failed" : ""}`;
  const statusDetail = <>
    {deleteError || label}
    {!deleteError && state.phase === "failed" && state.detail ? ` · ${state.detail}` : ""}
    {!deleteError && state.phase === "conflict" && state.detail ? ` · ${state.detail}` : ""}
    {!deleteError && state.phase === "failed" ? <button type="button" onClick={() => void persist()}>Retry</button> : null}
  </>;
  const modeToggle = <div className="workbench-mode" role="group" aria-label="Editor mode">
    <button type="button" className={mode === "write" ? "is-active" : undefined} aria-pressed={mode === "write"} onClick={() => setMode("write")}>Write</button>
    <button type="button" className={mode === "preview" ? "is-active" : undefined} aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Preview</button>
  </div>;

  const actionsMenu = variant === "page" ? <div className="workbench-menu">
    <button
      ref={menuTriggerRef}
      type="button"
      className="icon-button"
      aria-label="Document actions"
      title="Document actions"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-controls={menuOpen ? menuId : undefined}
      disabled={editingLocked || state.phase === "conflict"}
      onClick={toggleActionsMenu}
    >
      <MoreHorizontal size={16} aria-hidden="true" />
    </button>
    {menuOpen ? <div
      ref={menuRef}
      id={menuId}
      className="workbench-actions-menu"
      role="menu"
      aria-label="Document actions"
      style={menuPos ? { top: menuPos.top, right: menuPos.right } : undefined}
    >
      <button type="button" role="menuitem" className="is-danger" disabled={deleting} onClick={() => { setMenuOpen(false); setMenuPos(null); void remove(); }}>
        <Trash2 size={14} aria-hidden="true" />Delete document
      </button>
    </div> : null}
  </div> : null;

  const headerActions = <>
    {actionsMenu}
    {variant === "panel" ? <a className="icon-button" href={workbenchDocumentPath(documentId)} aria-label="Expand" title="Expand"><Expand size={16} aria-hidden="true" /></a> : null}
    {variant === "panel" ? <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button> : null}
  </>;

  const body = <>
    <WorkbenchAskNibie
      selection={selection}
      state={ai}
      busy={editingLocked}
      onOpen={() => updateAi((latest) => openWorkbenchAiPrompt(latest))}
      onInstructionChange={(value) => updateAi((latest) => setWorkbenchAiInstruction(latest, value))}
      onGenerate={() => void runSelectionEdit()}
      onStop={() => reviseAbortRef.current?.abort()}
      onClose={() => {
        updateAi((latest) => closeWorkbenchAiPrompt(latest));
        if (textareaRef.current) captureSelectionFromTextarea(textareaRef.current);
        else if (!selectionRef.current?.text) rememberSelection(null);
      }}
    />
    <form className="workbench-stage" onSubmit={(event) => event.preventDefault()} onBlur={handleBlur}>
      {roomName && variant === "page" ? <p className="workbench-room">Room · {roomName}</p> : null}
      <input className="workbench-title" aria-label="Document title" autoComplete="off" value={state.draft.title} maxLength={workbenchTitleLimit} disabled={editingLocked} onChange={(event) => changeDraft({ title: event.target.value })} />
      {mode === "write" ? (
        <textarea
          ref={textareaRef}
          className="workbench-body"
          aria-label="Document"
          placeholder="Write in Markdown…"
          value={state.draft.content}
          maxLength={workbenchContentLimit}
          disabled={editingLocked}
          onChange={(event) => changeDraft({ content: event.target.value })}
          onSelect={(event) => captureSelectionFromTextarea(event.currentTarget)}
          onKeyUp={(event) => captureSelectionFromTextarea(event.currentTarget)}
          onMouseUp={(event) => captureSelectionFromTextarea(event.currentTarget)}
        />
      ) : (
        <div className="workbench-preview" role="region" aria-label="Document preview" tabIndex={0}>
          {state.draft.content.trim()
            ? <MessageMarkdown content={state.draft.content} />
            : <p className="workbench-preview-empty">Nothing to preview yet. Switch to Write and add Markdown.</p>}
        </div>
      )}
    </form>
  </>;

  if (variant === "panel") {
    return <div className="workbench-panel-editor">
      <header className="workbench-panel-top">
        <p className={statusClass} role="status">{statusDetail}</p>
        {modeToggle}
        <div className="workbench-panel-actions">{headerActions}</div>
      </header>
      {body}
    </div>;
  }

  return <main className="workbench-shell">
    <header className="workbench-top">
      <Link className="workbench-back" href={workbenchPath} aria-label="Back to documents" title="Back to documents"><ArrowLeft size={16} aria-hidden="true" /></Link>
      <p className={statusClass} role="status">{statusDetail}</p>
      {modeToggle}
      <div className="workbench-top-actions">{headerActions}</div>
    </header>
    {body}
  </main>;
}
