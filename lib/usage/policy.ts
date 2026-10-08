import type { ChatModel } from "@/lib/chat/validation";

export const WEEKLY_FREE_CREDIT_LIMIT = 500;
export const WEEK_STARTS_ON_UTC_DAY = 1; // Monday, ISO weekday

export type UsageKind = "chat" | "research";

/** Product-policy credits for ordinary chat generations (not provider dollars). */
export const weeklyCreditCost: Readonly<Record<ChatModel, number>> = {
  Fast: 1,
  Balanced: 3,
  High: 6,
};

/**
 * Deep Research charges the synthesis mode plus a fixed multi-call overhead so
 * planner / follow-up / multi-query search cannot undercount as one mode credit.
 * Overhead = planner(1) + follow-up(1) + search/fetch budget(4).
 */
export const RESEARCH_CREDIT_OVERHEAD = 6;

export const researchCreditCost: Readonly<Record<ChatModel, number>> = {
  Fast: weeklyCreditCost.Fast + RESEARCH_CREDIT_OVERHEAD,
  Balanced: weeklyCreditCost.Balanced + RESEARCH_CREDIT_OVERHEAD,
  High: weeklyCreditCost.High + RESEARCH_CREDIT_OVERHEAD,
};

export function creditCostFor(mode: ChatModel, kind: UsageKind = "chat"): number {
  return kind === "research" ? researchCreditCost[mode] : weeklyCreditCost[mode];
}

export type WeeklyUsage = {
  creditsUsed: number;
  creditsRemaining: number;
  resetAt: string;
};

export function utcWeekStart(now: Date): Date {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
}

export function utcWeekReset(now: Date): Date {
  const weekStart = utcWeekStart(now);
  weekStart.setUTCDate(weekStart.getUTCDate() + 7);
  return weekStart;
}

export function creditsRemaining(creditsUsed: number): number {
  if (!Number.isSafeInteger(creditsUsed) || creditsUsed < 0) throw new RangeError("creditsUsed must be a non-negative safe integer");
  return Math.max(0, WEEKLY_FREE_CREDIT_LIMIT - creditsUsed);
}
