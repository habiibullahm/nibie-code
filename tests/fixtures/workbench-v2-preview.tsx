"use client";

import { FilePenLine } from "lucide-react";
import { WorkbenchEditor } from "@/components/workbench-editor";
import type { WorkbenchDocument } from "@/lib/workbench/types";

const sampleMarkdown = `# Clinic onboarding

## Intake checklist
- Confirm patient identity
- Capture insurance and consent
- Note scheduling constraints

## Follow-up
Assign owners before the visit ends.

\`\`\`ts
const status = "ready";
\`\`\`
`;

const document: WorkbenchDocument = {
  id: "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60",
  title: "Clinic onboarding notes",
  content: sampleMarkdown,
  revision: 1,
  room_id: null,
  room_name: null,
  created_at: "2026-10-03T00:00:00.000Z",
  updated_at: "2026-10-03T00:00:00.000Z",
};

type State = "editor" | "prompt" | "preview" | "review";

/** Dev-only layout fixture: chat column + workbench panel chrome for visual QA. */
export function WorkbenchPreviewFixture({ state }: { state: State }) {
  const initialMode = state === "preview" ? "preview" : "write";
  return <main className="chat-workspace has-workbench" data-testid="workbench-v2-preview">
    <section className="chat-main" aria-label="Chat workspace">
      <header className="chat-header"><div className="header-model"><span className="header-context">Clinic ops</span></div></header>
      <div className="conversation-scroll has-messages">
        <div className="message-list">
          <article className="message-row assistant">
            <div className="message-content assistant">
              <p>Here is a finished reply you can open in Workbench.</p>
              <div className="message-actions">
                <button type="button" className="message-action is-icon" aria-label="Edit in Workbench" title="Edit in Workbench">
                  <FilePenLine size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
    <button type="button" className="workbench-panel-scrim" aria-label="Close editor backdrop" />
    <aside className="workbench-panel" role="dialog" aria-label="Workbench editor">
      {state === "editor" || state === "prompt" || state === "preview" ? (
        <WorkbenchEditor document={document} variant="panel" initialMode={initialMode} onClose={() => undefined} />
      ) : null}
      {state === "review" ? <WorkbenchReviewChrome /> : null}
    </aside>
  </main>;
}

function WorkbenchReviewChrome() {
  return <div className="workbench-panel-editor">
    <header className="workbench-panel-top">
      <p className="workbench-status" role="status">Saved</p>
      <div className="workbench-mode" role="group" aria-label="Editor mode">
        <button type="button" className="is-active" aria-pressed="true">Write</button>
        <button type="button" aria-pressed="false">Preview</button>
      </div>
      <div className="workbench-panel-actions">
        <button type="button" className="icon-button" aria-label="AI Assist" title="AI Assist" disabled>✧</button>
        <button type="button" className="icon-button" aria-label="Expand" title="Expand">⛶</button>
        <button type="button" className="icon-button" aria-label="Close" title="Close">✕</button>
      </div>
    </header>
    <div className="workbench-ai is-review" role="region" aria-label="Suggested revision">
      <div className="workbench-ai-review-header">
        <h2>Suggested revision</h2>
        <div className="workbench-ai-actions">
          <button type="button" className="icon-button workbench-ai-action" aria-label="Apply" title="Apply">✓</button>
          <button type="button" className="icon-button workbench-ai-action" aria-label="Discard" title="Discard">✕</button>
        </div>
      </div>
      <div className="workbench-ai-diff">
        <div className="workbench-ai-line is-removed"><span>−</span><pre>## Intake checklist</pre></div>
        <div className="workbench-ai-line is-added"><span>+</span><pre>## Intake checklist (revised)</pre></div>
        <div className="workbench-ai-line is-same"><span> </span><pre>- Confirm patient identity</pre></div>
        <div className="workbench-ai-line is-added"><span>+</span><pre>- Capture insurance and consent before triage</pre></div>
      </div>
      <div className="workbench-ai-mobile-actions">
        <button type="button" className="workbench-ai-text-action is-primary">Apply</button>
        <button type="button" className="workbench-ai-text-action">Discard</button>
      </div>
    </div>
    <form className="workbench-stage" onSubmit={(event) => event.preventDefault()}>
      <input className="workbench-title" aria-label="Document title" value="Clinic onboarding notes" readOnly />
      <textarea className="workbench-body" aria-label="Document" value={document.content} readOnly />
    </form>
  </div>;
}
