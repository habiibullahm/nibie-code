import { describe, expect, it } from "vitest";
import { composerRouteLabel } from "../../lib/agents/composer-label";

describe("composer route label", () => {
  it("shows the agent name for a snapshot and the mode for a built-in chat", () => {
    expect(composerRouteLabel({ routing_kind: null, selected_model: "Fast", agent_name_snapshot: null })).toEqual({ kind: "model" });
    expect(composerRouteLabel({ routing_kind: "user_provider", selected_model: "Balanced", agent_name_snapshot: "Coding" })).toEqual({ kind: "agent", label: "Coding" });
  });
});
