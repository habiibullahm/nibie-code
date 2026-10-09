import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { WorkbenchList } from "@/components/workbench-list";
import { WORKBENCH_UI_ENABLED } from "@/lib/workbench/flags";
import { listWorkbenchDocuments } from "@/lib/workbench/read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workbench" };

export default async function WorkbenchPage() {
  if (!WORKBENCH_UI_ENABLED) notFound();
  await requireAuthenticatedUser();
  const { documents, error } = await listWorkbenchDocuments();
  return <WorkbenchList documents={documents} error={error} />;
}
