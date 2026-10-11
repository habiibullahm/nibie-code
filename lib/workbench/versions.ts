import type { WorkbenchVersionSource } from "@/lib/workbench/types";

export function formatWorkbenchVersionSource(source: WorkbenchVersionSource): string {
  return source === "ai" ? "AI-applied" : "Manual";
}
