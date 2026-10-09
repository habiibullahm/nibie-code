import type { WorkbenchDraft } from "@/lib/workbench/types";

export type WorkbenchSavePhase = "saved" | "saving" | "failed" | "conflict";

export type WorkbenchEditorState = {
  draft: WorkbenchDraft;
  persisted: WorkbenchDraft;
  revision: number;
  phase: WorkbenchSavePhase;
  detail: string | null;
};

export function draftsMatch(left: WorkbenchDraft, right: WorkbenchDraft) {
  return left.title === right.title && left.content === right.content;
}

export function initialWorkbenchEditorState(draft: WorkbenchDraft, revision = 1): WorkbenchEditorState {
  return { draft, persisted: { ...draft }, revision, phase: "saved", detail: null };
}

export function isWorkbenchDirty(state: WorkbenchEditorState) {
  return !draftsMatch(state.draft, state.persisted);
}

// Saved is only true once the visible draft matches a successful write.
export function saveStatusLabel(state: WorkbenchEditorState): "Saved" | "Saving…" | "Save failed" | "Newer version saved elsewhere" | null {
  if (state.phase === "saving") return "Saving…";
  if (state.phase === "conflict") return "Newer version saved elsewhere";
  if (state.phase === "failed") return "Save failed";
  if (isWorkbenchDirty(state)) return null;
  return "Saved";
}

export function editWorkbenchDraft(state: WorkbenchEditorState, draft: WorkbenchDraft): WorkbenchEditorState {
  return { ...state, draft };
}

export function beginWorkbenchSave(state: WorkbenchEditorState): WorkbenchEditorState {
  return { ...state, phase: "saving", detail: null };
}

export function succeedWorkbenchSave(
  state: WorkbenchEditorState,
  saved: WorkbenchDraft,
  revision: number,
): WorkbenchEditorState {
  return { ...state, persisted: { ...saved }, revision, phase: "saved", detail: null };
}

export function failWorkbenchSave(state: WorkbenchEditorState, detail: string): WorkbenchEditorState {
  return { ...state, draft: state.draft, phase: "failed", detail };
}

export function conflictWorkbenchSave(state: WorkbenchEditorState, detail = "This document changed in another tab. Discard your local edits or reload the latest version."): WorkbenchEditorState {
  return { ...state, phase: "conflict", detail };
}

export function replaceWorkbenchFromServer(
  state: WorkbenchEditorState,
  saved: WorkbenchDraft,
  revision: number,
): WorkbenchEditorState {
  return {
    draft: { ...saved },
    persisted: { ...saved },
    revision,
    phase: "saved",
    detail: null,
  };
}
