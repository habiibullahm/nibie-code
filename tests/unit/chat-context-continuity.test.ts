import { describe, expect, it } from "vitest";
import { buildContext } from "../../lib/context/build-context";
import { CONTEXT_POLICY_TEXT, contextPolicyFor, HISTORY_INCOMPLETE_INSTRUCTION } from "../../lib/context/context-policy";
import { toProviderMessages } from "../../lib/ai/provider-messages";
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
  it.each(["Fast", "Balanced", "High"] as const)("removes the %s omission notice when reallocation recovers all supplied history", (responseMode) => {
    const saved = { ...summary(2), objective: "o".repeat(2400) };
    const thread = messages(9);
    thread[2].content = "Correction: use Redis.";
    thread[8].content = "Use the updated one.";
    const extraPolicyInstruction = "Preserve the user's latest correction.";
    const completeCore = `${contextPolicyFor(responseMode)}\n\n${extraPolicyInstruction}`;
    const inputBudgetTokens = 16_384 - 2_048;
    // Initially the summary fits exactly after the protected turns, leaving no
    // space for the uncovered correction. The notice makes that summary too
    // large, so the second allocation can recover every raw turn instead.
    const protectedTotal = inputBudgetTokens - estimateTokens(completeCore)
      - estimateTokens(thread[8].content) - estimateTokens(renderThreadSummary(saved));
    let remaining = protectedTotal;
    for (let index = 3; index < 8; index++) {
      const tokens = index === 7 ? remaining : Math.floor(protectedTotal / 5);
      thread[index].content = "x".repeat(tokens * 4);
      remaining -= tokens;
    }
    const plan = buildContext(input({ messages: thread, currentPosition: 9, summary: saved, responseMode, extraPolicyInstruction }));
    expect(plan.continuity).toEqual({ countCapOmissions: 0, budgetOmissions: 0, summaryState: "budget" });
    const provider = toProviderMessages(plan);
    expect(provider.filter((message) => message.role !== "system").map((message) => message.content)).toEqual(thread.map((message) => message.content));
    expect(provider[0].content).toBe(completeCore);
    expect(provider[0].content).not.toContain(HISTORY_INCOMPLETE_INSTRUCTION);
    expect(plan.budget.estimatedTokens).toBe(plan.blocks.filter((block) => block.included).reduce((tokens, block) => tokens + block.tokenEstimate, 0));
    expect(plan.budget.estimatedTokens).toBeLessThanOrEqual(inputBudgetTokens);
  });

  it("ignores duplicate, invalid, future, or retained positions in caller omission metadata", () => {
    const plan = buildContext(input({
      messages: messages(41).slice(-32),
      omittedMessagePositions: [8, 8, 9, 0, -1, 1.5, Number.NaN, 10, 41, 42],
    }));
    expect(plan.continuity.countCapOmissions).toBe(2);
    expect(plan.continuity.budgetOmissions).toBe(0);
    expect(toProviderMessages(plan)[0].content).toContain(HISTORY_INCOMPLETE_INSTRUCTION);
  });

  it("does not infer missing messages from noncontiguous positions", () => {
    const thread = messages(3).map((message) => ({ ...message, position: message.position * 10 }));
    const plan = buildContext(input({ messages: thread, currentPosition: 30 }));
    expect(plan.continuity.countCapOmissions).toBe(0);
    expect(plan.budget.truncated).toBe(false);
    expect(toProviderMessages(plan)[0].content).not.toContain(HISTORY_INCOMPLETE_INSTRUCTION);
  });

  it.each(["Fast", "Balanced", "High"] as const)("tells %s when earlier supplied history is absent without pretending to recall it", (responseMode) => {
    const plan = buildContext(input({ responseMode }));
    expect(toProviderMessages(plan)[0].content).toContain(HISTORY_INCOMPLETE_INSTRUCTION);
    expect(plan.continuity).toEqual({ countCapOmissions: 9, budgetOmissions: 0, summaryState: "not_needed" });
    expect(plan.budget.truncated).toBe(true);
    expect(plan.budget.estimatedTokens).toBeLessThanOrEqual(plan.budget.inputBudgetTokens);
    expect(toProviderMessages(plan).at(-1)?.content).toBe("Message 41");
  });

  it("keeps complete supplied history unchanged and does not imply that omitted sources were recovered", () => {
    const plan = buildContext(input({ summary: summary(9) }));
    expect(plan.continuity).toEqual({ countCapOmissions: 0, budgetOmissions: 0, summaryState: "included" });
    expect(toProviderMessages(plan)[0].content).not.toContain(HISTORY_INCOMPLETE_INSTRUCTION);
    expect(toProviderMessages(plan).some((message) => message.content === "Message 1")).toBe(false);
    expect(plan.blocks.find((block) => block.id === "thread_summary")?.authority).toBe("untrusted_data");
  });

  it.each(["Correction: use Redis rather than Kafka.", "Koreksi: gunakan Redis, bukan Kafka."])("preserves a retained correction and terse follow-up across a refreshed request: %s", (correction) => {
    const thread = messages(41);
    thread[38] = { ...thread[38], content: correction };
    thread[40] = { ...thread[40], content: "Use the updated one / pakai yang diperbarui." };
    const request = input({ messages: thread, summary: { ...summary(8), decisions: "Use Kafka." } });
    const plan = buildContext(request);
    expect(plan.continuity.summaryState).toBe("stale");
    const provider = toProviderMessages(plan);
    expect(provider.some((message) => message.content === correction)).toBe(true);
    expect(provider.some((message) => message.content.includes("Use Kafka."))).toBe(false);
    expect(provider.at(-1)?.content).toBe(thread[40].content);
    expect(provider).toEqual(toProviderMessages(buildContext(structuredClone(request))));
  });

  it("distinguishes token omissions from the message-count limit without exposing private text", () => {
    const thread = messages(9);
    thread[2].content = "private correction ".repeat(1000);
    const plan = buildContext(input({ messages: thread, currentPosition: 9, capabilities: { contextWindowTokens: estimateTokens(CONTEXT_POLICY_TEXT) + 400, maxOutputTokens: 40 } }));
    expect(plan.continuity.countCapOmissions).toBe(0);
    expect(plan.continuity.budgetOmissions).toBe(3);
    expect(toProviderMessages(plan)[0].content).toContain(HISTORY_INCOMPLETE_INSTRUCTION);
    expect(JSON.stringify(plan.continuity)).not.toContain("private correction");
    expect(JSON.stringify(plan.diagnostics)).not.toContain("private correction");
  });
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
