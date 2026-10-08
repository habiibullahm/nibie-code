export const CHAT_ROLES = ["general", "developer", "researcher", "writer", "product_lead", "custom"] as const;

export type ChatRole = (typeof CHAT_ROLES)[number];

export const chatRoleLabels: Record<ChatRole, string> = {
  general: "General",
  developer: "Developer",
  researcher: "Researcher",
  writer: "Writer",
  product_lead: "Product Lead",
  custom: "Custom",
};

export const chatRoleDetails: Record<ChatRole, string> = {
  general: "Default Nibie behavior",
  developer: "Technical collaborator",
  researcher: "Evidence-first analysis",
  writer: "Drafts and revisions",
  product_lead: "Scope and trade-offs",
  custom: "Your instructions only",
};

/** Soft guidance character budget (matches DB CHECK). */
export const customInstructionsLimit = 2_000;

export const CHAT_ROLE_REGISTRY_VERSION = "chat-role-registry-v1" as const;

export const defaultChatRole: ChatRole = "general";

export const chatRoleDisclaimer =
  "These instructions guide Nibie's replies. They do not override safety rules or authorize tools.";
