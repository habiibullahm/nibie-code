import { z } from "zod";
import { pinContentLimit, pinTitleLimit, type PinDraft } from "@/lib/pins/types";

const singleLineControls = /[\u0000-\u001F\u007F]/;
const multilineControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const pinTitleSchema = z.string().trim().min(1).max(pinTitleLimit).refine((value) => !singleLineControls.test(value));
const pinContentSchema = z.string().trim().min(1).max(pinContentLimit).refine((value) => !multilineControls.test(value));

export const pinDraftSchema = z.object({
  title: pinTitleSchema,
  content: pinContentSchema,
}).strict();

export function parsePinDraft(input: unknown): { data: PinDraft } | { error: string } {
  const parsed = pinDraftSchema.safeParse(input);
  if (!parsed.success) return { error: pinValidationMessage(parsed.error) };
  return { data: parsed.data };
}

export function pinValidationMessage(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === "title") return "Pin titles must be 80 characters or fewer, with no line breaks.";
  if (field === "content") return "Pin content must be 1,000 characters or fewer.";
  return "Choose a valid pin.";
}
