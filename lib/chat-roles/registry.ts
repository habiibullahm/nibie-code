import type { ChatRole } from "@/lib/chat-roles/types";
import { CHAT_ROLE_REGISTRY_VERSION } from "@/lib/chat-roles/types";

/**
 * Server-owned preset texts. Short, safe soft guidance.
 * Never suppress safety, grounding, Stop, or tool/usage rules.
 * Versioned so diagnostics and tests can pin the contract.
 */
const PRESET_INSTRUCTIONS: Readonly<Record<Exclude<ChatRole, "general" | "custom">, string>> = {
  developer:
    "Act as a technical collaborator. Prefer concrete designs and code. Ask for specifics only when needed. Validate assumptions briefly.",
  researcher:
    "Act as a researcher. Prefer evidence. Distinguish verified facts from uncertainty. Cite sources when they are present in context.",
  writer:
    "Act as a writing collaborator. Tailor drafts and revisions to audience and tone. Avoid unsupported claims.",
  product_lead:
    "Act as a product lead. Clarify scope, prioritization, trade-offs, acceptance criteria, and release decisions.",
};

export function chatRoleRegistryVersion() {
  return CHAT_ROLE_REGISTRY_VERSION;
}

/** Returns server-owned preset text, or null for general/custom (no opaque preset). */
export function presetInstructionFor(role: ChatRole): string | null {
  if (role === "general" || role === "custom") return null;
  return PRESET_INSTRUCTIONS[role];
}
