import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { WorkbenchList } from "@/components/workbench-list";
import { listWorkbenchDocuments } from "@/lib/workbench/read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workbench" };

export default async function WorkbenchPage() {
  await requireAuthenticatedUser();
  const { documents, error } = await listWorkbenchDocuments();
  return <WorkbenchList documents={documents} error={error} />;
}
