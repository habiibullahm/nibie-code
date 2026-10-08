import "server-only";

import type { ActionDefinition } from "@/lib/actions/types";
import { webSearchAction } from "@/lib/actions/tools/web-search";

/**
 * Central allowlist. Unknown IDs are rejected — never dynamically import from model text.
 * Register every Action explicitly here.
 */
const ACTIONS: readonly ActionDefinition[] = [webSearchAction];

const BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

export function listRegisteredActions(): readonly ActionDefinition[] {
  return ACTIONS;
}

export function getAction(actionId: string): ActionDefinition | undefined {
  return BY_ID.get(actionId);
}

export function isRegisteredAction(actionId: string): boolean {
  return BY_ID.has(actionId);
}

export function assertRegisteredAction(actionId: string): ActionDefinition {
  const action = BY_ID.get(actionId);
  if (!action) {
    throw new UnknownActionError(actionId);
  }
  return action;
}

export class UnknownActionError extends Error {
  readonly code = "unknown_action" as const;
  constructor(readonly actionId: string) {
    super(`Unknown Action: ${actionId}`);
    this.name = "UnknownActionError";
  }
}
