import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { stoppedPlaceholder } from "@/lib/chat/stop";
import { persistMessageSources } from "@/lib/citations/persist";
import type { SourceReference } from "@/lib/citations/types";
import { logWarn } from "@/lib/observability/logger";

export type GenerationTerminalStatus = "complete" | "interrupted" | "error";
export type GenerationPersistResult = "saved" | "stopped" | "failed";

/** One writer per generation. Stop owns its saved visible text; late writes only touch streaming rows. */
export function createGenerationPersistence(input: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  assistantId: string;
  requestId: string;
  /** Context preparation happens after the writer is created; read the final allowlist at save time. */
  citationSources: () => readonly SourceReference[];
  onFailure?: (status: GenerationTerminalStatus) => void;
}) {
  const { supabase, userId, conversationId, assistantId, requestId } = input;
  let citationSourcesPersisted = false;

  const persistCitationSourcesForKeptReply = async (keptContent: string) => {
    const sources = input.citationSources();
    if (citationSourcesPersisted || !sources.length) return;
    if (!keptContent.trim() || keptContent === stoppedPlaceholder) return;
    // Set before awaiting: overlapping Stop/disconnect saves must not insert twice.
    citationSourcesPersisted = true;
    const savedSources = await persistMessageSources({
      supabase,
      userId,
      conversationId,
      messageId: assistantId,
      sources,
    });
    if (!savedSources.ok) {
      citationSourcesPersisted = false;
      logWarn("citation.sources.persist_failed", { requestId, sourceCount: sources.length });
    }
  };

  const persist = async (content: string, status: GenerationTerminalStatus): Promise<GenerationPersistResult> => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .update({ content, status })
        .eq("id", assistantId)
        .eq("status", "streaming")
        .select("id")
        .maybeSingle();
      if (!error && data) {
        if (status === "complete" || status === "interrupted") {
          await persistCitationSourcesForKeptReply(content);
        }
        return "saved";
      }
      if (!error) {
        const stopped = await supabase.from("messages").select("status").eq("id", assistantId).maybeSingle();
        if (!stopped.error && stopped.data?.status === "interrupted") {
          // Stop already saved the visible partial. Keep Sources available on reload, too.
          await persistCitationSourcesForKeptReply(content);
          return "stopped";
        }
      }
    } catch { /* reported by the caller's existing failure policy */ }
    input.onFailure?.(status);
    return "failed";
  };

  return { persist, persistCitationSourcesForKeptReply };
}
