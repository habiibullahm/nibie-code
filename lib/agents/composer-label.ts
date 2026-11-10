export function composerRouteLabel(row: { routing_kind: string | null; selected_model: string; agent_name_snapshot: string | null }) {
  if (row.routing_kind == null) return { kind: "model" as const };
  return { kind: "agent" as const, label: row.agent_name_snapshot || "Agent" };
}
