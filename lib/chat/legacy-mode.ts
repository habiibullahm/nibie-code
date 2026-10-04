import { z } from "zod";
import { modelChoiceSchema } from "@/lib/chat/models";
import { modelSchema, type ChatModel } from "@/lib/chat/validation";

// Compatibility for values written by earlier builds. Server code only (chat route, server actions, conversation loader):
// no client component imports this, so new requests and everything the browser holds use Fast / Balanced / High.
// A unit test guards that boundary.

// Display names the previous picker showed, mapped to the mode they sat behind.
const legacyDisplayNames: Record<string, ChatModel> = {
  "minimax m2.7": "Fast",
  "deepseek v4.1 flash": "Balanced",
  "gpt-6 luna": "High",
};

// Reads a saved conversation mode: the canonical ids, the old "Reasoning" id (now High), any casing, and old display names.
export function normalizeSavedMode(saved: unknown): ChatModel | null {
  const parsed = modelSchema.safeParse(saved);
  if (parsed.success) return parsed.data;
  if (typeof saved !== "string") return null;
  const key = saved.trim().toLowerCase();
  if (key === "reasoning") return "High";
  return modelSchema.options.find((mode) => mode.toLowerCase() === key) ?? legacyDisplayNames[key] ?? null;
}

// Request input from a stale client: only the exact old id "Reasoning" is accepted, as High. Everything else stays strict.
const acceptLegacyRequestMode = (value: unknown) => (value === "Reasoning" ? "High" : value);
export const modelInputSchema = z.preprocess(acceptLegacyRequestMode, modelSchema);
export const modelChoiceInputSchema = z.preprocess(acceptLegacyRequestMode, modelChoiceSchema);
