"use client";

import { FilePenLine } from "lucide-react";
import { WorkbenchEditor } from "@/components/workbench-editor";
import type { WorkbenchDocument } from "@/lib/workbench/types";

const document: WorkbenchDocument = {
  id: "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60",
  title: "Clinic onboarding notes",
  content: "## Patient intake\n\n- Confirm insurance and preferred pharmacy\n- Keep scheduling constraints clear\n- Assign follow-up owners\n\n**Next:** share the checklist with the care team.",
  revision: 1,
  room_id: null,
  room_name: null,
  created_at: "2026-10-03T00:00:00.000Z",
  updated_at: "2026-10-03T00:00:00.000Z",
};

type State = "editor" | "prompt" | "preview";

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
      <WorkbenchEditor document={document} variant="panel" initialMode={initialMode} onClose={() => undefined} />
    </aside>
  </main>;
}
