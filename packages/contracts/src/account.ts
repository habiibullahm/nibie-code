import { z } from "zod";
import {
  DELETE_ALL_CONFIRMATION,
  EXPORT_PRODUCT,
  EXPORT_VERSION,
  SIGN_OUT_SCOPE,
  isDeleteAllConfirmed,
} from "./account-export.js";

const exportedAttachmentSchema = z.object({
  originalName: z.string().min(1),
  extractedText: z.string().min(1),
}).strict();

const exportedMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: z.enum(["complete", "streaming", "interrupted", "error"]),
  position: z.number().int(),
  createdAt: z.string().min(1),
  replyToMessageId: z.string().nullable(),
  attachments: z.array(exportedAttachmentSchema),
}).strict();

const exportedConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  selectedModel: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  messages: z.array(exportedMessageSchema),
}).strict();

export const accountExportSchema = z.object({
  product: z.literal(EXPORT_PRODUCT),
  exportVersion: z.literal(EXPORT_VERSION),
  exportedAt: z.string().min(1),
  conversations: z.array(exportedConversationSchema),
}).strict();

export const deleteConversationsRequestSchema = z.object({
  confirmation: z.string(),
}).strict();

export const deleteConversationsResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
}).strict();

export const signOutRequestSchema = z.object({}).strict();

export const signOutResponseSchema = z.object({
  scope: z.literal(SIGN_OUT_SCOPE),
}).strict();

export type AccountExport = z.infer<typeof accountExportSchema>;
export type DeleteConversationsResponse = z.infer<typeof deleteConversationsResponseSchema>;
export type SignOutResponse = z.infer<typeof signOutResponseSchema>;

export function parseDeleteConversationsRequest(input: unknown): { confirmation: typeof DELETE_ALL_CONFIRMATION } | { error: string } {
  const parsed = deleteConversationsRequestSchema.safeParse(input);
  if (!parsed.success || !isDeleteAllConfirmed(parsed.data.confirmation)) {
    return { error: "Type DELETE to confirm." };
  }
  return { confirmation: DELETE_ALL_CONFIRMATION };
}

export function parseSignOutRequest(input: unknown): { scope: typeof SIGN_OUT_SCOPE } | { error: string } {
  const body = input === undefined || input === null ? {} : input;
  const parsed = signOutRequestSchema.safeParse(body);
  if (!parsed.success) return { error: "Invalid request." };
  return { scope: SIGN_OUT_SCOPE };
}
