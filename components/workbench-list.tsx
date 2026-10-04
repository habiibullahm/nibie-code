"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { createWorkbenchDocumentAction } from "@/app/actions/workbench";
import { chatPath, workbenchDocumentPath } from "@/lib/routes";
import type { WorkbenchSummary } from "@/lib/workbench/types";

export function WorkbenchList({ documents, error }: { documents: WorkbenchSummary[]; error: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [createError, setCreateError] = useState("");
  const pendingRef = useRef(false);

  async function createDocument() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setCreateError("");
    const result = await createWorkbenchDocumentAction({});
    if (result.error || !result.data) {
      pendingRef.current = false;
      setCreateError(result.error ?? "We couldn't create that document. Please try again.");
      setPending(false);
      return;
    }
    router.push(workbenchDocumentPath(result.data.id));
  }

  return <main className="workbench-shell">
    <header className="workbench-top">
      <Link className="workbench-back" href={chatPath} aria-label="Back to chat" title="Back to chat"><ArrowLeft size={16} aria-hidden="true" /></Link>
      <h1>Workbench</h1>
      <button type="button" className="workbench-create" aria-label={pending ? "Creating document" : "New document"} title={pending ? "Creating document" : "New document"} disabled={pending} onClick={() => void createDocument()}><FilePlus2 size={16} aria-hidden="true" /></button>
    </header>
    <div className="workbench-stage">
      {error ? <p className="workbench-error" role="alert">{error}</p> : null}
      {createError ? <p className="workbench-error" role="alert">{createError}</p> : null}
      {documents.length === 0 && !error ? <div className="workbench-empty">
        <p>No documents yet.</p>
        <p>Start one here, or continue a finished response from chat.</p>
      </div> : <ul className="workbench-list">{documents.map((document) => <li key={document.id}><Link className="workbench-card" href={workbenchDocumentPath(document.id)}><span>{document.title}</span>{document.room_name ? <small>Room · {document.room_name}</small> : null}<time dateTime={document.updated_at}>{document.updated_at.slice(0, 10)}</time></Link></li>)}</ul>}
    </div>
  </main>;
}
