import { describe, expect, it } from "vitest";
import { parseAgentWrite } from "../../lib/agents/validation";

const systemAgent = {
  name: "General",
  avatar: "spark",
  providerBinding: "system",
  systemMode: "Balanced",
  systemInstructions: "You write short answers.",
};

describe("agent write validation", () => {
  it("accepts a system agent and a router agent", () => {
    expect(parseAgentWrite(systemAgent).success).toBe(true);
    expect(parseAgentWrite({
      name: "Coding",
      avatar: "code",
      providerBinding: "explicit",
      providerConfigId: "11111111-1111-4111-8111-111111111111",
      model: "deepseek-chat",
      temperature: 0.2,
      maxOutputTokens: 1024,
    }).success).toBe(true);
  });

  it("rejects a system agent that also names a user model", () => {
    expect(parseAgentWrite({ ...systemAgent, model: "gpt-hidden" }).success).toBe(false);
    expect(parseAgentWrite({ ...systemAgent, providerBinding: "default_provider", systemMode: null, model: "deepseek-chat" }).success).toBe(true);
  });
});
