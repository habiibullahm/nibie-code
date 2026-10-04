import type { WorkbenchDraft } from "@/lib/workbench/types";

export type WorkbenchSavePhase = "saved" | "saving" | "failed";

export type WorkbenchEditorState = {
  draft: WorkbenchDraft;
  persisted: WorkbenchDraft;
  phase: WorkbenchSavePhase;
  detail: string | null;
};

export function draftsMatch(left: WorkbenchDraft, right: WorkbenchDraft) {
  return left.title === right.title && left.content === right.content;
}

export function initialWorkbenchEditorState(draft: WorkbenchDraft): WorkbenchEditorState {
  return { draft, persisted: { ...draft }, phase: "saved", detail: null };
}

export function isWorkbenchDirty(state: WorkbenchEditorState) {
  return !draftsMatch(state.draft, state.persisted);
}

// Saved is only true once the visible draft matches a successful write.
export function saveStatusLabel(state: WorkbenchEditorState): "Saved" | "Saving…" | "Save failed" | null {
  if (state.phase === "saving") return "Saving…";
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

export function succeedWorkbenchSave(state: WorkbenchEditorState, saved: WorkbenchDraft): WorkbenchEditorState {
  return { ...state, persisted: { ...saved }, phase: "saved", detail: null };
}

export function failWorkbenchSave(state: WorkbenchEditorState, detail: string): WorkbenchEditorState {
  return { ...state, draft: state.draft, phase: "failed", detail };
}
