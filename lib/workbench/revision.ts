import type { WorkbenchDraft } from "@/lib/workbench/types";

export type WorkbenchAiPhase = "idle" | "prompt" | "generating" | "review" | "failed" | "cancelled";

export type WorkbenchAiState = {
  phase: WorkbenchAiPhase;
  instruction: string;
  original: WorkbenchDraft | null;
  suggestion: WorkbenchDraft | null;
  runId: string | null;
  expectedRevision: number | null;
  error: string | null;
};

export function initialWorkbenchAiState(): WorkbenchAiState {
  return {
    phase: "idle",
    instruction: "",
    original: null,
    suggestion: null,
    runId: null,
    expectedRevision: null,
    error: null,
  };
}

export function openWorkbenchAiPrompt(state: WorkbenchAiState): WorkbenchAiState {
  if (state.phase === "generating" || state.phase === "review") return state;
  return { ...initialWorkbenchAiState(), phase: "prompt", instruction: state.instruction };
}

export function closeWorkbenchAiPrompt(state: WorkbenchAiState): WorkbenchAiState {
  if (state.phase === "generating") return state;
  return initialWorkbenchAiState();
}

export function setWorkbenchAiInstruction(state: WorkbenchAiState, instruction: string): WorkbenchAiState {
  if (state.phase !== "prompt" && state.phase !== "failed" && state.phase !== "cancelled") return state;
  return { ...state, instruction, error: null, phase: "prompt" };
}

export function beginWorkbenchAiGenerate(
  state: WorkbenchAiState,
  input: { original: WorkbenchDraft; expectedRevision: number; runId: string },
): WorkbenchAiState {
  return {
    phase: "generating",
    instruction: state.instruction.trim(),
    original: { ...input.original },
    suggestion: null,
    runId: input.runId,
    expectedRevision: input.expectedRevision,
    error: null,
  };
}

export function completeWorkbenchAiProposal(
  state: WorkbenchAiState,
  suggestion: WorkbenchDraft,
): WorkbenchAiState {
  if (state.phase !== "generating") return state;
  return {
    ...state,
    phase: "review",
    suggestion: { ...suggestion },
    error: null,
  };
}

export function failWorkbenchAi(state: WorkbenchAiState, error: string): WorkbenchAiState {
  return {
    ...state,
    phase: "failed",
    suggestion: null,
    error,
  };
}

export function cancelWorkbenchAi(state: WorkbenchAiState): WorkbenchAiState {
  return {
    ...state,
    phase: "cancelled",
    suggestion: null,
    error: "Suggestion cancelled.",
  };
}

export function discardWorkbenchAiProposal(): WorkbenchAiState {
  return initialWorkbenchAiState();
}

export function applyWorkbenchAiProposal(state: WorkbenchAiState): WorkbenchAiState {
  if (state.phase !== "review" || !state.suggestion) return state;
  return initialWorkbenchAiState();
}

export function isWorkbenchAiProposalComplete(state: WorkbenchAiState): boolean {
  return state.phase === "review" && Boolean(state.suggestion?.content != null && state.original);
}

export function canApplyWorkbenchAiProposal(state: WorkbenchAiState): boolean {
  return isWorkbenchAiProposalComplete(state);
}
