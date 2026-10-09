"use client";

import { ArrowUp, Square } from "lucide-react";
import type { WorkbenchAiState } from "@/lib/workbench/revision";
import { workbenchInstructionLimit } from "@/lib/workbench/types";

type Props = {
  state: WorkbenchAiState;
  busy?: boolean;
  onInstructionChange: (value: string) => void;
  onGenerate: () => void;
  onStop: () => void;
  onClosePrompt: () => void;
};

export function WorkbenchAiRevision({
  state,
  busy = false,
  onInstructionChange,
  onGenerate,
  onStop,
  onClosePrompt,
}: Props) {
  if (state.phase === "idle") return null;

  if (state.phase === "prompt" || state.phase === "failed" || state.phase === "cancelled") {
    const canSubmit = state.instruction.trim().length > 0 && !busy;
    return <div className="workbench-ai" role="region" aria-label="AI Assist">
      <div className="workbench-ai-prompt-row">
        <label className="visually-hidden" htmlFor="workbench-ai-instruction">Ask AI to edit</label>
        <input
          id="workbench-ai-instruction"
          className="workbench-ai-input"
          value={state.instruction}
          maxLength={workbenchInstructionLimit}
          placeholder="Ask AI to edit…"
          disabled={busy}
          autoFocus
          onChange={(event) => onInstructionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && canSubmit) {
              event.preventDefault();
              onGenerate();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClosePrompt();
            }
          }}
        />
        <button type="button" className="icon-button workbench-ai-action" aria-label="Submit" title="Submit" disabled={!canSubmit} onClick={onGenerate}>
          <ArrowUp size={16} aria-hidden="true" />
        </button>
      </div>
      {state.error ? <p className="workbench-ai-error" role="alert">{state.error}</p> : null}
    </div>;
  }

  if (state.phase === "generating" || state.phase === "applying") {
    return <div className="workbench-ai" role="status" aria-live="polite">
      <div className="workbench-ai-prompt-row">
        <p className="workbench-ai-status">{state.phase === "applying" ? "Applying edit…" : "Editing document…"}</p>
        {state.phase === "generating" ? (
          <button type="button" className="icon-button workbench-ai-action" aria-label="Stop" title="Stop" onClick={onStop}>
            <Square size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>;
  }

  return null;
}
