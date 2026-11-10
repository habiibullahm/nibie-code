import "server-only";
import type { ModelRoute } from "@/lib/ai/registry";
import type { ChatModel } from "@/lib/chat/validation";
import { ProviderRequestError } from "@/lib/ai/provider-error";

type SnapshotRow = {
  routing_kind: "system_mode" | "user_provider" | null;
  creditMode: ChatModel;
  agent_name_snapshot?: string | null;
  system_mode_snapshot?: ChatModel | null;
  model_snapshot?: string | null;
};

export type TurnPlan = { creditMode: ChatModel; agentName: string | null; route: ModelRoute | null };

export function planFromSnapshot(row: SnapshotRow, systemRoute: ModelRoute | null, userRoute: ModelRoute | null): TurnPlan {
  if (row.routing_kind == null) {
    return { creditMode: row.creditMode, agentName: null, route: null };
  }
  if (row.routing_kind === "system_mode") {
    if (!systemRoute || !row.system_mode_snapshot) throw new ProviderRequestError("unavailable", null);
    return { creditMode: row.system_mode_snapshot, agentName: row.agent_name_snapshot ?? "Agent", route: systemRoute };
  }
  if (!userRoute || userRoute.model !== row.model_snapshot) throw new ProviderRequestError("unavailable", null);
  return { creditMode: "Balanced", agentName: row.agent_name_snapshot ?? "Agent", route: userRoute };
}
