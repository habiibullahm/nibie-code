import { describe, expect, it } from "vitest";
import { snapshotForAgent } from "../../lib/agents/snapshot";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Coding",
  system_instructions: "Prefer patches.",
  temperature: null,
  max_output_tokens: null,
};

describe("agent snapshot", () => {
  it("freezes a system mode and a user provider without sharing mutable fields", () => {
    expect(snapshotForAgent({ ...base, provider_binding: "system", system_mode: "High", provider_config_id: null, model: null }, null).routing_kind).toBe("system_mode");
    const user = snapshotForAgent({
      ...base,
      provider_binding: "default_provider",
      system_mode: null,
      provider_config_id: null,
      model: "deepseek-chat",
      temperature: 0.4,
      max_output_tokens: 512,
    }, "22222222-2222-4222-8222-222222222222");
    expect(user).toMatchObject({
      routing_kind: "user_provider",
      provider_config_id: "22222222-2222-4222-8222-222222222222",
      model_snapshot: "deepseek-chat",
      selected_model: "Balanced",
      instructions_snapshot: "Prefer patches.",
    });
  });

  it("refuses a default-provider agent when the user has no default", () => {
    expect(() => snapshotForAgent({ ...base, provider_binding: "default_provider", system_mode: null, provider_config_id: null, model: "m" }, null)).toThrow(/default provider/);
  });
});
