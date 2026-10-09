import { workbenchVersionLimit, type WorkbenchVersionSource } from "@/lib/workbench/types";

export type VersionSnapshotInput = {
  title: string;
  content: string;
  documentRevision: number;
  source: WorkbenchVersionSource;
  revisionRunId?: string | null;
};

export function shouldSkipDuplicateVersion(
  latest: { title: string; content: string } | null | undefined,
  next: Pick<VersionSnapshotInput, "title" | "content">,
): boolean {
  if (!latest) return false;
  return latest.title === next.title && latest.content === next.content;
}

/** Ids to delete so retained count stays within the limit after inserting one new row. */
export function versionIdsToPrune(idsNewestFirst: string[], limit = workbenchVersionLimit): string[] {
  if (idsNewestFirst.length <= limit) return [];
  return idsNewestFirst.slice(limit);
}

export function formatWorkbenchVersionSource(source: WorkbenchVersionSource): string {
  return source === "ai" ? "AI-applied" : "Manual";
}
