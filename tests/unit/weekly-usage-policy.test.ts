import { describe, expect, it } from "vitest";
import { creditsRemaining, utcWeekReset, utcWeekStart, weeklyCreditCost, WEEKLY_FREE_CREDIT_LIMIT } from "@/lib/usage/policy";
import { weeklyLimitNotice } from "@/lib/usage/format";

describe("weekly free AI usage policy", () => {
  it("assigns the fixed product costs to Fast, Balanced, and High", () => {
    expect(weeklyCreditCost).toEqual({ Fast: 1, Balanced: 3, High: 6 });
  });

  it("uses Monday 00:00 UTC as the week boundary", () => {
    expect(utcWeekStart(new Date("2026-10-04T23:59:59.999Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(utcWeekStart(new Date("2026-10-05T00:00:00.000Z")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("returns the exact next Monday reset timestamp", () => {
    expect(utcWeekReset(new Date("2026-10-05T00:00:00.000Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("computes remaining allowance including zero at exhaustion", () => {
    expect(creditsRemaining(0)).toBe(WEEKLY_FREE_CREDIT_LIMIT);
    expect(creditsRemaining(28)).toBe(472);
    expect(creditsRemaining(WEEKLY_FREE_CREDIT_LIMIT)).toBe(0);
  });

  it("formats the supplied server reset timestamp for a readable exhausted state", () => {
    expect(weeklyLimitNotice("2026-10-12T00:00:00.000Z", "en-US", "UTC")).toBe("You've reached your weekly Nibie usage limit. Your allowance resets Oct 12, 2026, 12:00 AM UTC.");
  });

  it("rejects invalid usage totals instead of manufacturing remaining credits", () => {
    expect(() => creditsRemaining(-1)).toThrow(RangeError);
    expect(() => creditsRemaining(1.5)).toThrow(RangeError);
  });
});
