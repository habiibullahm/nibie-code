import { notFound } from "next/navigation";
import { WorkbenchPreviewFixture } from "@/tests/fixtures/workbench-v2-preview";

export default async function WorkbenchV2Preview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; viewport?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const state = query.state === "review" ? "review" : query.state === "prompt" ? "prompt" : "editor";
  return <WorkbenchPreviewFixture state={state} />;
}
