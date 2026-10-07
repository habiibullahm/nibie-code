import { WEB_SEARCH_ACTION_ID } from "@/lib/actions/ids";
import type { ActionRunStatus } from "@/lib/actions/types";

/** Minimal user-facing Action status copy — no agent dashboard. */
export const ACTION_RUNNING_LABELS: Record<string, string> = {
  [WEB_SEARCH_ACTION_ID]: "Searching the web…",
};

export const ACTION_USED_LABELS: Record<string, string> = {
  [WEB_SEARCH_ACTION_ID]: "Used Web Search",
};

export function actionRunningLabel(actionId: string): string {
  return ACTION_RUNNING_LABELS[actionId] ?? "Running Action…";
}

export function actionUsedLabel(actionId: string): string {
  return ACTION_USED_LABELS[actionId] ?? "Used Action";
}

export function actionStatusLabel(actionId: string, status: ActionRunStatus): string | null {
  if (status === "running" || status === "requested") return actionRunningLabel(actionId);
  if (status === "completed") return actionUsedLabel(actionId);
  if (status === "cancelled") return "Action stopped";
  if (status === "failed") return null;
  if (status === "waiting_for_confirmation") return "Waiting for confirmation…";
  return null;
}
