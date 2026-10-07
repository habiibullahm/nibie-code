import { z } from "zod";
import { aboutYouLimit, preferredLanguages, preferredNameLimit, preferenceModels, responseLengths, responseStyles, type PreferencePatch } from "@/lib/preferences/types";

export const preferredLanguageSchema = z.enum(preferredLanguages);
export const preferenceModelSchema = z.enum(preferenceModels);
export const responseLengthSchema = z.enum(responseLengths);
export const responseStyleSchema = z.enum(responseStyles);

const nameControls = /[\u0000-\u001F\u007F]/;
const aboutControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const preferredNameSchema = z.string().trim().min(1).max(preferredNameLimit).refine((value) => !nameControls.test(value));
const aboutYouSchema = z.string().trim().min(1).max(aboutYouLimit).refine((value) => !aboutControls.test(value));

export const preferencePatchSchema = z.object({
  preferredName: z.union([z.null(), preferredNameSchema]).optional(),
  preferredLanguage: preferredLanguageSchema.optional(),
  defaultModel: preferenceModelSchema.optional(),
  responseLength: responseLengthSchema.optional(),
  responseStyle: responseStyleSchema.optional(),
  aboutYou: z.union([z.null(), aboutYouSchema]).optional(),
  recallEnabled: z.boolean().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0);

// A blank name or note clears the field. Unknown keys are left untouched so strict validation still rejects them.
export function normalizePreferencePatch(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const patch = { ...(input as Record<string, unknown>) };
  for (const key of ["preferredName", "aboutYou"]) {
    if (typeof patch[key] === "string" && patch[key].trim() === "") patch[key] = null;
  }
  return patch;
}

export function parsePreferencePatch(input: unknown): { data: PreferencePatch } | { error: string } {
  const parsed = preferencePatchSchema.safeParse(normalizePreferencePatch(input));
  if (!parsed.success) return { error: preferenceValidationMessage(parsed.error) };
  return { data: parsed.data };
}

export function preferenceValidationMessage(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === "preferredName") return "Preferred name must be 80 characters or fewer, with no line breaks.";
  if (field === "aboutYou") return "About you must be 1,500 characters or fewer.";
  return "Choose a valid preference.";
}
