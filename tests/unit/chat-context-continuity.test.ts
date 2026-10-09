import { describe, expect, it } from "vitest";
import { buildContext } from "../../lib/context/build-context";
import { CONTEXT_POLICY_TEXT } from "../../lib/context/context-policy";
import { estimateTokens } from "../../lib/context/token-budget";
import { renderThreadSummary } from "../../lib/context/thread-context";
import { defaultUserPreferences } from "../../lib/preferences/types";
import type { BuildContextInput, ThreadMessage, ThreadSummary } from "../../lib/context/context-types";

const summary = (coversThroughPosition: number): ThreadSummary => ({
  objective: "Build Nibie", importantContext: "Tenant isolation is required.",
  decisions: "Use the existing provider and stay within budget.", completedWork: "Audit",
  currentState: "Implement", openQuestions: "Live evaluation budget", coversThroughPosition,
  updatedAt: "2026-10-09T00:00:00.000Z",
});
const messages = (count: number): ThreadMessage[] => Array.from({ length: count }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant", content: `Message ${index + 1}`, position: index + 1,
}));
const input = (overrides: Partial<BuildContextInput>): BuildContextInput => ({
  capabilities: { contextWindowTokens: 16_384, maxOutputTokens: 2_048 },
  preferences: defaultUserPreferences(), preferenceReadFailed: false, summary: null,
  messages: messages(41), currentPosition: 41, ...overrides,
});

describe("bounded chat continuity", () => {
  it("retains Room instructions before allocating a large uncovered bridge", () => {
    const thread = messages(9);
    thread[2] = { ...thread[2]!, content: "x".repeat(400) };
    const recentTokens = thread.slice(3).reduce((total, message) => total + estimateTokens(message.content), 0);
    const plan = buildContext(input({
      messages: thread, currentPosition: 9, summary: summary(2),
      room: { name: "Project", instructions: "Use the Room's current constraints.", brief: null },
      capabilities: { contextWindowTokens: estimateTokens(CONTEXT_POLICY_TEXT) + recentTokens + estimateTokens(renderThreadSummary(summary(2))) + 100 + 4, maxOutputTokens: 4 },
    }));
    expect(plan.blocks.find((block) => block.id === "room")?.included).toBe(true);
    expect(plan.blocks.find((block) => block.id === "thread_summary")?.included).toBe(false);
    expect(plan.budget.estimatedTokens).toBeLessThanOrEqual(plan.budget.inputBudgetTokens);
  });
  it("reports history omitted by the message-count cap even when tokens fit", () => {
    const plan = buildContext(input({}));
    expect(plan.diagnostics.recentMessageCount).toBe(32);
    expect(plan.budget.truncated).toBe(true);
    expect(plan.diagnostics.sources.find((source) => source.type === "recent_messages")?.reason).toMatch(/left out|omitted/i);
  });

  it("reports the gap between a lagging summary and capped raw history", () => {
    const plan = buildContext(input({ summary: summary(8) }));
    expect(plan.budget.truncated).toBe(true);
    expect(plan.blocks.find((block) => block.id === "thread_summary")?.included).toBe(false);
  });

  it("does not report truncation for history represented by a fitted summary", () => {
    expect(buildContext(input({ summary: summary(9) })).budget.truncated).toBe(false);
  });

  it.each([3, 7])("does not supply outdated summary facts across a dropped correction at position %i", (gapPosition) => {
    const thread = messages(9).map((message) => ({
      ...message,
      content: message.position === gapPosition ? "Correction: use Redis instead of Kafka. ".repeat(300) : message.content,
    }));
    const plan = buildContext(input({
      messages: thread, currentPosition: 9,
      summary: { ...summary(2), decisions: "Use Kafka." },
      capabilities: { contextWindowTokens: estimateTokens(CONTEXT_POLICY_TEXT) + 400, maxOutputTokens: 40 },
    }));
    expect(plan.blocks.find((block) => block.id === "thread_summary")?.included).toBe(false);
    expect(plan.blocks.filter((block) => block.included).some((block) => block.text.includes("Use Kafka."))).toBe(false);
    expect(plan.blocks.at(-1)?.text).toBe("Message 9");
    expect(plan.budget.truncated).toBe(true);
    expect(plan.budget.estimatedTokens).toBeLessThanOrEqual(plan.budget.inputBudgetTokens);
  });

  it.each(["Fast", "Balanced", "High"] as const)("keeps the fitted thread summary ahead of large attachments in %s", (responseMode) => {
    const thread = messages(9);
    const protectedTokens = thread.slice(-6).reduce((total, message) => total + estimateTokens(message.content), 0);
    const plan = buildContext(input({
      messages: thread, currentPosition: 9, summary: summary(3), responseMode,
      capabilities: { contextWindowTokens: estimateTokens(CONTEXT_POLICY_TEXT) + protectedTokens + 1_500 + 4, maxOutputTokens: 4 },
      attachments: [{ name: "large.txt", typeLabel: "Text", text: "x".repeat(24_000), truncated: false, pageCount: null, current: true }],
    }));
    expect(plan.blocks.find((block) => block.id === "thread_summary")?.included).toBe(true);
    expect(plan.blocks.find((block) => block.id === "thread_summary")?.authority).toBe("untrusted_data");
    expect(plan.budget.estimatedTokens).toBeLessThanOrEqual(plan.budget.inputBudgetTokens);
    expect(plan.blocks.filter((block) => block.dialogueRole)).toHaveLength(6);
    expect(plan.blocks.at(-1)?.text).toBe("Message 9");
  });

  it.each(["Fast", "Balanced", "High"] as const)("reserves the uncovered bridge alongside its summary before attachment text in %s", (responseMode) => {
    const thread = messages(9);
    const plan = buildContext(input({
      messages: thread, currentPosition: 9, summary: summary(2), responseMode,
      capabilities: { contextWindowTokens: estimateTokens(CONTEXT_POLICY_TEXT) + 1_600, maxOutputTokens: 4 },
      attachments: [{ name: "large.txt", typeLabel: "Text", text: "x".repeat(24_000), truncated: false, pageCount: null, current: true }],
    }));
    expect(plan.blocks.find((block) => block.id === "thread_summary")?.included).toBe(true);
    expect(plan.blocks.filter((block) => block.dialogueRole).map((block) => block.text)).toEqual(thread.slice(2).map((message) => message.content));
    expect(plan.blocks.find((block) => block.id === "attachment")?.included).toBe(true);
    expect(plan.budget.truncated).toBe(true);
    expect(plan.budget.estimatedTokens).toBeLessThanOrEqual(plan.budget.inputBudgetTokens);
  });
});
