import "server-only";

import { detectMemoryIntent } from "@/lib/recall/intent";
import { draftFromSaveBody } from "@/lib/recall/normalize";
import { deactivateMatchingMemories, upsertMemoryByKey, type MemoryStoreClient } from "@/lib/recall/store";
import { operationalCodes } from "@/lib/observability/codes";
import { logInfo, logWarn } from "@/lib/observability/logger";

export type HandleRecallTurnInput = {
  supabase: MemoryStoreClient;
  userId: string;
  message: string;
  recallEnabled: boolean;
  conversationId?: string | null;
  messageId?: string | null;
  requestId?: string;
};

export type HandleRecallTurnResult = {
  wrote: boolean;
  forgot: number;
  degraded: boolean;
};

/** Orchestrate explicit save/forget for a chat turn. Never blocks chat on failure. */
export async function handleRecallTurn(input: HandleRecallTurnInput): Promise<HandleRecallTurnResult> {
  if (!input.recallEnabled) {
    logInfo("memory.disabled", { requestId: input.requestId, stage: "write" });
    return { wrote: false, forgot: 0, degraded: false };
  }

  const intent = detectMemoryIntent(input.message);
  if (intent.kind === "none") return { wrote: false, forgot: 0, degraded: false };

  try {
    if (intent.kind === "save") {
      logInfo("memory.write.requested", { requestId: input.requestId });
      const draft = draftFromSaveBody(intent.raw, {
        conversationId: input.conversationId,
        messageId: input.messageId,
      });
      if (!draft) {
        logWarn("memory.write.failed", { requestId: input.requestId, category: "invalid", code: operationalCodes.recallWriteFailed });
        return { wrote: false, forgot: 0, degraded: true };
      }
      const result = await upsertMemoryByKey(input.supabase, input.userId, draft);
      if (result.error || !result.memory) {
        logWarn("memory.write.failed", { requestId: input.requestId, category: "store", code: operationalCodes.recallWriteFailed, type: draft.type });
        return { wrote: false, forgot: 0, degraded: true };
      }
      logInfo("memory.write.succeeded", { requestId: input.requestId, type: result.memory.type });
      return { wrote: true, forgot: 0, degraded: false };
    }

    const forgot = await deactivateMatchingMemories(input.supabase, intent.raw);
    if (forgot.error) {
      logWarn("memory.write.failed", { requestId: input.requestId, category: "forget", code: operationalCodes.recallWriteFailed });
      return { wrote: false, forgot: 0, degraded: true };
    }
    if (forgot.count) logInfo("memory.deleted", { requestId: input.requestId, count: forgot.count, stage: "forget" });
    return { wrote: false, forgot: forgot.count, degraded: false };
  } catch {
    logWarn("memory.write.failed", { requestId: input.requestId, category: "exception", code: operationalCodes.recallWriteFailed });
    return { wrote: false, forgot: 0, degraded: true };
  }
}
