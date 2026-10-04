import { z } from "zod";
import { modelSchema, type ChatModel } from "@/lib/chat/validation";

// Nibie exposes ONE capability picker: Fast / Balanced / High. Which provider and model sit behind each mode is decided on the
// server (lib/ai/registry.ts); the browser never sees it.
export type ModelOption = { id: ChatModel; label: string; description: string };

// "Auto" means: follow the conversation's saved mode.
export const modelChoiceSchema = modelSchema.or(z.literal("Auto"));
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

// User-facing picker copy. The mode picks capability and routing only; it never sets how long an answer is.
export const modelPickerCopy: Record<ChatModel, { label: string; description: string }> = {
  Fast: { label: "Fast", description: "Quick answers" },
  Balanced: { label: "Balanced", description: "Best for everyday work" },
  High: { label: "High", description: "Deeper reasoning" },
};

// Used when a conversation's saved mode is not (or no longer) available.
const fallbackOrder: readonly ChatModel[] = ["Balanced", "Fast", "High"];

// Strict on purpose: the server normalizes anything older before it reaches the client.
export function resolveMode(saved: unknown, available: readonly ChatModel[]): ChatModel | null {
  const parsed = modelSchema.safeParse(saved);
  if (parsed.success && available.includes(parsed.data)) return parsed.data;
  return fallbackOrder.find((mode) => available.includes(mode)) ?? null;
}
