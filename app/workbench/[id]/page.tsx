import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { WorkbenchEditor } from "@/components/workbench-editor";
import { chatPath, workbenchPath } from "@/lib/routes";
import { getWorkbenchDocument } from "@/lib/workbench/read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workbench" };

export default async function WorkbenchDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuthenticatedUser();
  const { id } = await params;
  const { document, error } = await getWorkbenchDocument(id);
  if (error || !document) {
    return <main className="workbench-shell">
      <header className="workbench-top"><Link className="workbench-back" href={workbenchPath}>Documents</Link><Link className="workbench-back" href={chatPath}>Chat</Link></header>
      <div className="workbench-stage"><h1>{error ?? "This document is unavailable."}</h1></div>
    </main>;
  }
  return <WorkbenchEditor document={document} roomName={document.room_name} />;
}
