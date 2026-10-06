import type { ThreadMessage } from "@/lib/context/context-types";
import { PROTECTED_RECENT_COUNT } from "@/lib/context/token-budget";

// When a thread is long enough to summarize, and how far behind a summary may fall before it is refreshed.
export const SUMMARY_START_AFTER_COMPLETE_MESSAGES = 18;
export const SUMMARY_REFRESH_GAP = 8;
// One maintenance job reads at most this much transcript. A longer backlog is caught up over later replies.
export const SUMMARY_INPUT_CHAR_BUDGET = 24_000;
export const SUMMARY_MESSAGE_CHAR_CAP = 4_000;

// How the reply that would trigger maintenance ended. Only a reply saved as complete may move the summary.
export type ReplyOutcome = "complete" | "interrupted" | "stopped" | "error" | "persist_failed" | "replay";

export type SummaryLifecycleInput = {
  outcome: ReplyOutcome;
  // Position of the assistant reply that just completed.
  assistantPosition: number;
  // Complete messages in the conversation, including that reply.
  completeMessageCount: number;
  // Coverage of the stored summary, or null when the conversation has none.
  existingCoverage: number | null;
};

export type SummarySkipReason = "not_complete" | "invalid_input" | "below_threshold" | "no_target" | "already_covered" | "gap_below_threshold";

export type SummaryDecision =
  | { action: "skip"; reason: SummarySkipReason }
  | { action: "initial"; targetCoverage: number }
  | { action: "refresh"; fromCoverage: number; targetCoverage: number };

// The newest PROTECTED_RECENT_COUNT - 1 messages, through this reply, always stay raw in the next request, so the
// summary stops just before them.
export function targetCoverageFor(assistantPosition: number) {
  return assistantPosition - (PROTECTED_RECENT_COUNT - 1);
}

export function decideThreadSummary(input: SummaryLifecycleInput): SummaryDecision {
  if (input.outcome !== "complete") return { action: "skip", reason: "not_complete" };
  const { assistantPosition, completeMessageCount, existingCoverage } = input;
  if (!Number.isInteger(assistantPosition) || assistantPosition < 1 || !Number.isInteger(completeMessageCount) || completeMessageCount < 0
    || (existingCoverage !== null && (!Number.isInteger(existingCoverage) || existingCoverage < 1))) {
    return { action: "skip", reason: "invalid_input" };
  }
  const targetCoverage = targetCoverageFor(assistantPosition);
  if (existingCoverage === null) {
    if (completeMessageCount < SUMMARY_START_AFTER_COMPLETE_MESSAGES) return { action: "skip", reason: "below_threshold" };
    if (targetCoverage < 1) return { action: "skip", reason: "no_target" };
    return { action: "initial", targetCoverage };
  }
  // Coverage never moves backwards.
  if (targetCoverage <= existingCoverage) return { action: "skip", reason: "already_covered" };
  if (targetCoverage - existingCoverage < SUMMARY_REFRESH_GAP) return { action: "skip", reason: "gap_below_threshold" };
  return { action: "refresh", fromCoverage: existingCoverage, targetCoverage };
}

// A candidate is written only when it covers more than what is stored.
export function supersedesCoverage(existingCoverage: number | null, candidateCoverage: number) {
  return Number.isInteger(candidateCoverage) && candidateCoverage >= 1 && (existingCoverage === null || candidateCoverage > existingCoverage);
}

export type SummaryInputSlice = {
  messages: ThreadMessage[];
  // The coverage the new summary may claim: the target when every message through it fit, otherwise the last one read.
  coversThroughPosition: number;
};

function clampMessage(message: ThreadMessage): ThreadMessage {
  if (message.content.length <= SUMMARY_MESSAGE_CHAR_CAP) return message;
  return { ...message, content: `${message.content.slice(0, SUMMARY_MESSAGE_CHAR_CAP)} [message shortened]` };
}

// Initial: messages through the target. Refresh: only messages after the stored coverage through the target — the existing
// summary stands in for everything before. The oldest messages are read first and the slice stops at the input budget.
export function selectSummaryInput(messages: ThreadMessage[], decision: SummaryDecision): SummaryInputSlice | null {
  if (decision.action === "skip") return null;
  const after = decision.action === "refresh" ? decision.fromCoverage : 0;
  const eligible = messages
    .filter((message) => Number.isInteger(message.position) && message.position > after && message.position <= decision.targetCoverage
      && (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.length > 0)
    .sort((left, right) => left.position - right.position);
  const selected: ThreadMessage[] = [];
  let used = 0;
  for (const message of eligible) {
    const clamped = clampMessage(message);
    if (selected.length > 0 && used + clamped.content.length > SUMMARY_INPUT_CHAR_BUDGET) break;
    selected.push(clamped);
    used += clamped.content.length;
  }
  if (!selected.length) return null;
  const complete = selected.length === eligible.length;
  return { messages: selected, coversThroughPosition: complete ? decision.targetCoverage : selected[selected.length - 1].position };
}
