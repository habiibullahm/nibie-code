import type { ActionCapability, ActionDefinition, ActionErrorCode } from "@/lib/actions/types";

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; code: ActionErrorCode; reason: string; requiresConfirmation?: boolean };

/**
 * V1 policy: only `read` is generally enabled.
 * create/update/delete/execute are denied (confirmation metadata reserved for later).
 * The model cannot self-authorize — this check is server-side only.
 */
export function evaluateActionPermission(
  action: ActionDefinition,
  options?: { confirmed?: boolean },
): PermissionDecision {
  if (action.capability === "read") {
    if (action.requiresConfirmation && !options?.confirmed) {
      return {
        allowed: false,
        code: "confirmation_required",
        reason: "This Action requires confirmation before it can run.",
        requiresConfirmation: true,
      };
    }
    return { allowed: true };
  }

  // Future mutations: design confirmation gate without enabling them in V1.
  if (action.requiresConfirmation || MUTATING_CAPABILITIES.has(action.capability)) {
    return {
      allowed: false,
      code: "confirmation_required",
      reason: `Capability "${action.capability}" is not enabled in Actions V1.`,
      requiresConfirmation: true,
    };
  }

  return {
    allowed: false,
    code: "permission_denied",
    reason: `Capability "${action.capability}" is not permitted.`,
  };
}

const MUTATING_CAPABILITIES: ReadonlySet<ActionCapability> = new Set([
  "create",
  "update",
  "delete",
  "execute",
]);

export function isMutatingCapability(capability: ActionCapability): boolean {
  return MUTATING_CAPABILITIES.has(capability);
}
