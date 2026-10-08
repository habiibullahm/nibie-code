import { z } from "zod";
import { customInstructionsLimit } from "@/lib/chat-instructions/types";

const multilineControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const customInstructionsSchema = z
  .string()
  .trim()
  .min(1)
  .max(customInstructionsLimit)
  .refine((value) => !multilineControls.test(value));

export type ChatInstructionsPatch = {
  customInstructions: string | null;
};

function blankToNull(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

export function parseChatInstructionsPatch(input: unknown): { data: ChatInstructionsPatch } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Enter valid chat instructions." };
  }
  const raw = input as Record<string, unknown>;
  const instructionsRaw = blankToNull(raw.customInstructions ?? raw.custom_instructions ?? null);
  if (instructionsRaw === null || instructionsRaw === undefined) {
    return { data: { customInstructions: null } };
  }
  const instructionsParsed = customInstructionsSchema.safeParse(instructionsRaw);
  if (!instructionsParsed.success) {
    return { error: "Chat instructions must be 2,000 characters or fewer." };
  }
  return { data: { customInstructions: instructionsParsed.data } };
}

export function normalizeCustomInstructions(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > customInstructionsLimit || multilineControls.test(trimmed)) return null;
  return trimmed;
}
