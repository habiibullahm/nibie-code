import { describe, expect, it } from "vitest";
import { planFromSnapshot } from "../../lib/agents/resolve-turn";

describe("turn plan", () => {
  it("keeps a legacy row on the mode the route already normalized", () => {
    expect(planFromSnapshot({ routing_kind: null, creditMode: "Fast" }, null, null)).toMatchObject({ creditMode: "Fast", route: null, agentName: null });
  });

  it("uses the user route and Balanced credits without falling back", () => {
    const userRoute = { provider: "openai_compatible" as const, baseUrl: "https://router.nibie.app/v1", apiKey: "k", model: "deepseek-chat" };
    expect(planFromSnapshot({
      routing_kind: "user_provider",
      creditMode: "Balanced",
      agent_name_snapshot: "Coding",
      model_snapshot: "deepseek-chat",
    }, null, userRoute).route).toBe(userRoute);
    expect(() => planFromSnapshot({ routing_kind: "user_provider", creditMode: "Balanced", agent_name_snapshot: "Coding", model_snapshot: "deepseek-chat" }, null, null)).toThrow(/unavailable/);
  });
});
