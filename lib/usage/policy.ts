import type { ChatModel } from "@/lib/chat/validation";

export const WEEKLY_FREE_CREDIT_LIMIT = 500;
export const WEEK_STARTS_ON_UTC_DAY = 1; // Monday, ISO weekday

export const weeklyCreditCost: Readonly<Record<ChatModel, number>> = {
  Fast: 1,
  Balanced: 3,
  High: 6,
};

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
