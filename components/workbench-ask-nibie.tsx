"use client";

import { ArrowUp, Square, WandSparkles, X } from "lucide-react";
import type { WorkbenchAiState } from "@/lib/workbench/revision";
import { workbenchInstructionLimit } from "@/lib/workbench/types";

type Selection = { start: number; end: number; text: string };

type Props = {
  selection: Selection | null;
  state: WorkbenchAiState;
  busy?: boolean;
  onOpen: () => void;
  onInstructionChange: (value: string) => void;
  onGenerate: () => void;
  onStop: () => void;
  onClose: () => void;
};

export function WorkbenchAskNibie({
  selection,
  state,
  busy = false,
  onOpen,
  onInstructionChange,
  onGenerate,
  onStop,
  onClose,
}: Props) {
  const hasSelection = Boolean(selection && selection.text.length > 0);
  const asking = state.phase === "prompt" || state.phase === "failed" || state.phase === "cancelled";
  const running = state.phase === "generating" || state.phase === "applying";

  if (!hasSelection && !asking && !running) return null;

  if (running) {
    return <div className="workbench-ask" role="status" aria-live="polite">
      <div className="workbench-ask-row">
        <p className="workbench-ask-status">{state.phase === "applying" ? "Applying edit…" : "Asking Nibie…"}</p>
        {state.phase === "generating" ? (
          <button type="button" className="icon-button workbench-ai-action" aria-label="Stop" title="Stop" onClick={onStop}>
            <Square size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>;
  }

  if (asking) {
    const canSubmit = state.instruction.trim().length > 0 && !busy && hasSelection;
    return <div className="workbench-ask" role="region" aria-label="Ask Nibie">
      <div className="workbench-ask-row">
        <label className="visually-hidden" htmlFor="workbench-ask-instruction">Ask Nibie about the selection</label>
        <input
          id="workbench-ask-instruction"
          className="workbench-ai-input"
          value={state.instruction}
          maxLength={workbenchInstructionLimit}
          placeholder="Ask Nibie to change this…"
          disabled={busy || !hasSelection}
          autoFocus
          onChange={(event) => onInstructionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && canSubmit) {
              event.preventDefault();
              onGenerate();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button type="button" className="icon-button workbench-ai-action" aria-label="Submit" title="Submit" disabled={!canSubmit} onClick={onGenerate}>
          <ArrowUp size={16} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button workbench-ai-action" aria-label="Close Ask Nibie" title="Close" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {selection?.text ? <p className="workbench-ask-snippet" title={selection.text}>Selection · {selection.text.slice(0, 80)}{selection.text.length > 80 ? "…" : ""}</p> : null}
      {state.error ? <p className="workbench-ai-error" role="alert">{state.error}</p> : null}
      {!hasSelection ? <p className="workbench-ai-error" role="alert">Select text in the document to Ask Nibie.</p> : null}
    </div>;
  }

  return <div className="workbench-ask is-idle" role="region" aria-label="Selection actions">
    <button type="button" className="workbench-ask-trigger" aria-label="Ask Nibie" title="Ask Nibie" onClick={onOpen}>
      <WandSparkles size={14} aria-hidden="true" />
      <span>Ask Nibie</span>
    </button>
  </div>;
}
