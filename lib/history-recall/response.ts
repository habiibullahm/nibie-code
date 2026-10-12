import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createGenerationPersistence } from "@/lib/chat/orchestration/persist-result";
import { chatSseEvent } from "@/lib/chat/orchestration/stream-response";
import type { HistoryRecallIntent } from "./intent";
import { retrieveHistoryEvidence } from "./retrieve";
import { historyRecallGuard } from "./guard";
import { renderHistoryReply } from "./render";

/** Evidence-only V1: no provider prompt, saved Memory write, tool or summary call. */
export async function createHistoryRecallResponse(input: {
  supabase: SupabaseClient;
  request: Request;
  requestId: string;
  ownerId: string;
  conversationId: string;
  roomId: string | null;
  assistant: { id: string; position: number };
  intent: HistoryRecallIntent;
}) {
  const persistence = createGenerationPersistence({
    supabase: input.supabase, userId: input.ownerId, conversationId: input.conversationId,
    assistantId: input.assistant.id, requestId: input.requestId, citationSources: () => [],
  });
  const slot = historyRecallGuard.acquire(input.ownerId);
  if (!slot.ok) {
    const error = slot.reason === "busy" ? "Another history lookup is running. Please wait." : "History lookup limit reached. Please try again shortly.";
    await persistence.persist(error, "error");
    return Response.json({ error }, { status: 429, headers: { "retry-after": "60" } });
  }
  try {
    const result = await retrieveHistoryEvidence({ ...input, signal: input.request.signal });
    if (input.request.signal.aborted || result.status === "cancelled") {
      await persistence.persist("Response stopped.", "interrupted");
      return new Response(null, { status: 499 });
    }
    const content = renderHistoryReply(result, input.intent.language, new URL(input.request.url).origin);
    const saved = await persistence.persist(content, "complete");
    if (saved === "failed") return Response.json({ error: "History lookup could not be saved. Please try again." }, { status: 503 });
    // The same streaming-row compare-and-set used by chat protects a Stop that
    // arrives during the DB lookup/save. Never publish results after Stop won.
    const events = chatSseEvent("start", { id: input.assistant.id, position: input.assistant.position })
      + (saved === "saved" ? chatSseEvent("delta", { text: content }) : "")
      + chatSseEvent("status", { status: saved === "saved" ? "complete" : "interrupted" })
      + chatSseEvent("done", {});
    return new Response(events, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" } });
  } finally { slot.release(); }
}
