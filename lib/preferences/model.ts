import { resolveMode } from "@/lib/chat/models";
import type { ChatModel } from "@/lib/chat/validation";
import { preferenceModelSchema } from "@/lib/preferences/validation";
import type { PreferenceModel } from "@/lib/preferences/types";

export const preferenceModelToChatModel = {
  fast: "Fast",
  balanced: "Balanced",
  reasoning: "High",
} as const satisfies Record<PreferenceModel, ChatModel>;

export const chatModelToPreferenceModel = {
  Fast: "fast",
  Balanced: "balanced",
  High: "reasoning",
} as const satisfies Record<ChatModel, PreferenceModel>;

// The stored account default is only a starting point. A mode that is no longer configured uses the same
// Balanced → Fast → High fallback as a conversation whose saved mode disappeared.
export function resolveDefaultModel(stored: unknown, available: readonly ChatModel[]): ChatModel | null {
  const parsed = preferenceModelSchema.safeParse(stored);
  return resolveMode(parsed.success ? preferenceModelToChatModel[parsed.data] : undefined, available);
}

// Existing conversations keep conversations.selected_model. Only a chat that does not exist yet uses the account default.
export function modelForComposer(input: {
  hasConversation: boolean;
  conversationModel?: unknown;
  accountDefault: unknown;
  available: readonly ChatModel[];
}): ChatModel | null {
  if (input.hasConversation) return resolveMode(input.conversationModel, input.available);
  return resolveDefaultModel(input.accountDefault, input.available);
}
