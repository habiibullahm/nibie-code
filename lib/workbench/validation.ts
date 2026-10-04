import { z } from "zod";
import { untitledWorkbenchTitle, workbenchContentLimit, workbenchTitleLimit, type WorkbenchCreateInput, type WorkbenchDraft } from "@/lib/workbench/types";

const singleLineControls = /[\u0000-\u001F\u007F]/;
const contentControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const titleSchema = z.string().trim().min(1).max(workbenchTitleLimit).refine((value) => !singleLineControls.test(value));
const contentSchema = z.string().max(workbenchContentLimit).refine((value) => !contentControls.test(value));
const roomIdSchema = z.string().uuid();

export const workbenchCreateSchema = z.object({
  title: titleSchema.optional(),
  content: contentSchema.optional(),
  roomId: z.union([z.null(), roomIdSchema]).optional(),
}).strict();

export const workbenchWriteSchema = z.object({
  title: titleSchema,
  content: contentSchema,
}).strict();

export function validateWorkbenchId(value: unknown) {
  return z.string().uuid().safeParse(value);
}

export function parseWorkbenchCreate(input: unknown): { data: WorkbenchCreateInput } | { error: string } {
  const parsed = workbenchCreateSchema.safeParse(input ?? {});
  if (!parsed.success) return { error: workbenchValidationMessage(parsed.error) };
  return { data: parsed.data };
}

export function parseWorkbenchWrite(input: unknown): { data: WorkbenchDraft } | { error: string } {
  const parsed = workbenchWriteSchema.safeParse(input);
  if (!parsed.success) return { error: workbenchValidationMessage(parsed.error) };
  return { data: parsed.data };
}

export function workbenchValidationMessage(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === "title") return "Titles must be 120 characters or fewer, with no line breaks.";
  if (field === "content") return "Documents must be 100,000 characters or fewer.";
  if (field === "roomId") return "Choose a valid room.";
  return "Choose a valid document.";
}

export function workbenchCreateDefaults(input: WorkbenchCreateInput): WorkbenchDraft & { roomId: string | null } {
  return {
    title: input.title ?? untitledWorkbenchTitle,
    content: input.content ?? "",
    roomId: input.roomId ?? null,
  };
}
