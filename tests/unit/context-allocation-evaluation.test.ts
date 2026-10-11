import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { estimateTokens } from "@/lib/context/token-budget";
import { buildContext } from "@/lib/context/build-context";
import { toProviderMessages } from "@/lib/ai/provider-messages";
import { defaultUserPreferences } from "@/lib/preferences/types";
import type { BuildContextInput, ThreadMessage, ThreadSummary } from "@/lib/context/context-types";

// Sanitized allocation experiments, not generated answers or provider capabilities.
const current = "Correction: keep the API on Next.js. Explain the latest plan in Indonesian.";
const history: ThreadMessage[] = Array.from({ length: 31 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `Turn ${i + 1}: ${"sanitized project detail ".repeat(165)}`,
  position: i + 1,
}));
const summary: ThreadSummary = {
  objective: "Ship chat reliability", importantContext: "A Room holds authorized shared context",
  decisions: "Keep Next.js", completedWork: "Package CI", currentState: "Extract stream lifecycle",
  openQuestions: "Live acceptance", coversThroughPosition: 26, updatedAt: "2026-10-11T00:00:00Z",
};
const room = { name: "Architecture", instructions: "Respect the newest correction.", brief: {
  goal: "Ship reliable chat", currentFocus: "Lifecycle", importantDecisions: "Retain Next.js",
  openQuestions: "Human review", next: "Verify flows",
} };
const files = [{ name: "plan.txt", text: "authorized project context ".repeat(400) }];
const attachments = [{ name: "notes.txt", typeLabel: "Text", text: "authorized thread attachment ".repeat(1_000), truncated: false, pageCount: null, current: true }];
const scenarios: Array<[string, Partial<BuildContextInput>]> = [
  ["short", { messages: [{ role: "user", content: current, position: 1 }], currentPosition: 1 }],
  ["long", {}],
  ["room-files", { room, files, attachments }],
  ["summary-room-files", { room, files, attachments, summary }],
  ["summary-fetch-gap", { room, files, summary: { ...summary, coversThroughPosition: 2 }, messages: Array.from({ length: 40 }, (_, i) => ({ ...history[i % 31], position: i + 1 })).concat({ role: "user", content: current, position: 41 }), currentPosition: 41 }],
];
const windows = [8_192, 16_384, 32_768, 65_536];
const rows: Array<Record<string, unknown>> = [];

describe("offline context allocation evaluation", () => {
  for (const window of windows) for (const [scenario, overrides] of scenarios) {
    it(`${scenario} at ${window} policy tokens preserves current request and history continuity`, () => {
      const plan = buildContext({
        capabilities: { contextWindowTokens: window, maxOutputTokens: 2_048 },
        preferences: defaultUserPreferences(), preferenceReadFailed: false, summary: null,
        messages: [...history, { role: "user", content: current, position: 32 }], currentPosition: 32,
        ...overrides,
      });
      const providerMessages = toProviderMessages(plan);
      const providerMessageTextTokens = providerMessages.reduce((total, message) => total + estimateTokens(message.content), 0);
      expect(providerMessages.at(-1)).toEqual({ role: "user", content: current });
      expect(plan.blocks.find((block) => block.id === "core")?.included).toBe(true);
      // Smaller experimental ceilings are scored rather than assumed safe.
      if (window >= 16_384) expect(plan.budget.estimatedTokens).toBeLessThanOrEqual(plan.budget.inputBudgetTokens);
      expect(plan.budget.inputBudgetTokens + plan.budget.outputReserveTokens).toBe(window);
      const kept = plan.blocks.filter((block) => block.included && block.id === "recent_messages");
      // This synthetic history has unique turn labels. A retained raw history must be one continuous suffix.
      const positions = kept.map((block) => Number(block.text.match(/^Turn (\d+):/)?.[1]));
      if (scenario !== "summary-fetch-gap") {
        for (let i = 1; i < positions.length; i++) expect(positions[i]).toBe(positions[i - 1] + 1);
      }
      if (scenario === "summary-fetch-gap") expect(plan.blocks.find((block) => block.id === "thread_summary")?.included).toBe(false);
      rows.push({ window, scenario, ...plan.budget, withinBudget: plan.budget.estimatedTokens <= plan.budget.inputBudgetTokens, providerMessageTextTokens, rawEarlierMessages: kept.length,
        summaryIncluded: plan.blocks.some((block) => block.id === "thread_summary" && block.included),
        roomIncluded: plan.blocks.some((block) => block.id === "room" && block.included),
        fileIncluded: plan.blocks.some((block) => block.id === "file" && block.included),
        attachmentIncluded: plan.blocks.some((block) => block.id === "attachment" && block.included),
      });
    });
  }
});

afterAll(() => {
  if (rows.length !== windows.length * scenarios.length) return;
  const output = process.env.CONTEXT_ALLOCATION_REPORT;
  if (output) writeFileSync(output, JSON.stringify({
    kind: "deterministic-allocation-only", outputReserve: 2_048,
    estimator: "ceil(text.length / 4)", providerCalls: 0, rows,
  }, null, 2) + "\n");
});
