"use client";

import { Check, RefreshCw, Square, WandSparkles, X } from "lucide-react";
import { workbenchLineDiff } from "@/lib/workbench/diff";
import type { WorkbenchAiState } from "@/lib/workbench/revision";
import { canApplyWorkbenchAiProposal } from "@/lib/workbench/revision";
import { workbenchInstructionLimit } from "@/lib/workbench/types";

type Props = {
  state: WorkbenchAiState;
  busy?: boolean;
  onInstructionChange: (value: string) => void;
  onGenerate: () => void;
  onStop: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
  onClosePrompt: () => void;
};

export function WorkbenchAiRevision({
  state,
  busy = false,
  onInstructionChange,
  onGenerate,
  onStop,
  onApply,
  onDiscard,
  onRegenerate,
  onClosePrompt,
}: Props) {
  if (state.phase === "idle") return null;

  if (state.phase === "prompt" || state.phase === "failed" || state.phase === "cancelled") {
    const canSubmit = state.instruction.trim().length > 0 && !busy;
    return <div className="workbench-ai" role="region" aria-label="Improve with AI">
      <div className="workbench-ai-prompt-row">
        <label className="visually-hidden" htmlFor="workbench-ai-instruction">How should Nibie improve this document?</label>
        <input
          id="workbench-ai-instruction"
          className="workbench-ai-input"
          value={state.instruction}
          maxLength={workbenchInstructionLimit}
          placeholder="How should Nibie improve this document?"
          disabled={busy}
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
        <button type="button" className="icon-button workbench-ai-action" aria-label="Generate suggestion" title="Generate suggestion" disabled={!canSubmit} onClick={onGenerate}>
          <WandSparkles size={16} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button workbench-ai-action" aria-label="Close AI prompt" title="Close" onClick={onClosePrompt}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="workbench-ai-note">AI credits apply. The document won’t change until you apply a suggestion.</p>
      {state.error ? <p className="workbench-ai-error" role="alert">{state.error}</p> : null}
    </div>;
  }

  if (state.phase === "generating") {
    return <div className="workbench-ai" role="status" aria-live="polite">
      <div className="workbench-ai-prompt-row">
        <p className="workbench-ai-status">Generating suggestion…</p>
        <button type="button" className="icon-button workbench-ai-action" aria-label="Stop suggestion" title="Stop" onClick={onStop}>
          <Square size={14} aria-hidden="true" />
        </button>
      </div>
    </div>;
  }

  if (state.phase === "review" && state.original && state.suggestion) {
    const lines = workbenchLineDiff(state.original.content, state.suggestion.content);
    const canApply = canApplyWorkbenchAiProposal(state) && !busy;
    return <div className="workbench-ai is-review" role="region" aria-label="Review suggestion">
      <div className="workbench-ai-review-header">
        <h2>Review suggestion</h2>
        <div className="workbench-ai-actions">
          <button type="button" className="icon-button workbench-ai-action" aria-label="Apply changes" title="Apply changes" disabled={!canApply} onClick={onApply}>
            <Check size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button workbench-ai-action" aria-label="Discard suggestion" title="Discard suggestion" disabled={busy} onClick={onDiscard}>
            <X size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button workbench-ai-action" aria-label="Regenerate suggestion" title="Regenerate suggestion" disabled={busy} onClick={onRegenerate}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {state.original.title !== state.suggestion.title ? <p className="workbench-ai-title-diff"><span className="is-removed">{state.original.title}</span> → <span className="is-added">{state.suggestion.title}</span></p> : null}
      <div className="workbench-ai-diff" tabIndex={0}>
        {lines.map((line, index) => (
          <div key={`${line.kind}-${index}`} className={`workbench-ai-line is-${line.kind}`}>
            <span aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
            <pre>{line.text || " "}</pre>
          </div>
        ))}
      </div>
      <div className="workbench-ai-mobile-actions">
        <button type="button" className="workbench-ai-text-action is-primary" disabled={!canApply} onClick={onApply}>Apply changes</button>
        <button type="button" className="workbench-ai-text-action" disabled={busy} onClick={onDiscard}>Discard</button>
      </div>
    </div>;
  }

  return null;
}
