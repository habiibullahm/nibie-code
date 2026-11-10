import type { ChatModel } from "@/lib/chat/validation";

type AgentRow = {
  id: string;
  name: string;
  system_instructions: string | null;
  provider_binding: "system" | "explicit" | "default_provider";
  provider_config_id: string | null;
  system_mode: ChatModel | null;
  model: string | null;
  temperature: number | null;
  max_output_tokens: number | null;
};

export type ConversationSnapshot = {
  agent_id: string;
  agent_name_snapshot: string;
  routing_kind: "system_mode" | "user_provider";
  system_mode_snapshot: ChatModel | null;
  provider_config_id: string | null;
  model_snapshot: string | null;
  instructions_snapshot: string | null;
  temperature_snapshot: number | null;
  max_output_tokens_snapshot: number | null;
  selected_model: ChatModel;
};

export function snapshotForAgent(agent: AgentRow, defaultProviderConfigId: string | null): ConversationSnapshot {
  const shared = {
    agent_id: agent.id,
    agent_name_snapshot: agent.name,
    instructions_snapshot: agent.system_instructions,
    temperature_snapshot: agent.temperature,
    max_output_tokens_snapshot: agent.max_output_tokens,
  };
  if (agent.provider_binding === "system") {
    if (!agent.system_mode) throw new Error("This agent has no mode.");
    return {
      ...shared,
      routing_kind: "system_mode",
      system_mode_snapshot: agent.system_mode,
      provider_config_id: null,
      model_snapshot: null,
      temperature_snapshot: null,
      max_output_tokens_snapshot: null,
      selected_model: agent.system_mode,
    };
  }
  const providerId = agent.provider_binding === "explicit" ? agent.provider_config_id : defaultProviderConfigId;
  if (!providerId || !agent.model) throw new Error("Choose a default provider before using this agent.");
  return {
    ...shared,
    routing_kind: "user_provider",
    system_mode_snapshot: null,
    provider_config_id: providerId,
    model_snapshot: agent.model,
    selected_model: "Balanced",
  };
}
