import { z } from "zod";
import { CHAT_ROLES, customInstructionsLimit, type ChatRole } from "@/lib/chat-roles/types";

const multilineControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const chatRoleSchema = z.enum(CHAT_ROLES);

const customInstructionsSchema = z
  .string()
  .trim()
  .min(1)
  .max(customInstructionsLimit)
  .refine((value) => !multilineControls.test(value));

export type ChatRolePatch = {
  chatRole: ChatRole;
  customInstructions: string | null;
};

function blankToNull(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

export function parseChatRolePatch(input: unknown): { data: ChatRolePatch } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Choose a valid chat role." };
  }
  const raw = input as Record<string, unknown>;
  const roleParsed = chatRoleSchema.safeParse(raw.chatRole ?? raw.chat_role);
  if (!roleParsed.success) return { error: "Choose a valid chat role." };

  const instructionsRaw = blankToNull(raw.customInstructions ?? raw.custom_instructions ?? null);
  if (instructionsRaw === null || instructionsRaw === undefined) {
    return { data: { chatRole: roleParsed.data, customInstructions: null } };
  }
  const instructionsParsed = customInstructionsSchema.safeParse(instructionsRaw);
  if (!instructionsParsed.success) {
    return { error: "Custom instructions must be 2,000 characters or fewer." };
  }
  return { data: { chatRole: roleParsed.data, customInstructions: instructionsParsed.data } };
}

export function normalizeChatRole(value: unknown): ChatRole {
  const parsed = chatRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : "general";
}

export function normalizeCustomInstructions(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > customInstructionsLimit || multilineControls.test(trimmed)) return null;
  return trimmed;
}
