import "server-only";

import type { ChatModel } from "@/lib/chat/validation";
import type { UsageKind } from "@/lib/usage/policy";
import { reserveSpendCeilingMicros, type UsdMicros } from "@/lib/usage/pricing";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Default free-tier dollar ceilings — always on so credits alone cannot burn Sol spend. */
export const DEFAULT_USER_DAILY_SPEND_USD = 5;
export const DEFAULT_GLOBAL_HOURLY_SPEND_USD = 50;

export type SpendLimits = {
  userDailyUsdMicros: UsdMicros;
  globalHourlyUsdMicros: UsdMicros;
};

function parseUsdLimit(raw: string | undefined, fallbackUsd: number): UsdMicros {
  if (raw === undefined || raw.trim() === "") return Math.round(fallbackUsd * 1_000_000);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Spend limit must be a non-negative number.");
  return Math.round(parsed * 1_000_000);
}

/**
 * Server-enforced spend ceilings from env (names only in logs).
 * Unset → defaults. Explicit 0 → refuse all (fail closed).
 */
export function getSpendLimits(env: Env = process.env): SpendLimits {
  return {
    userDailyUsdMicros: parseUsdLimit(env.AI_SPEND_LIMIT_USER_DAILY_USD, DEFAULT_USER_DAILY_SPEND_USD),
    globalHourlyUsdMicros: parseUsdLimit(env.AI_SPEND_LIMIT_GLOBAL_HOURLY_USD, DEFAULT_GLOBAL_HOURLY_SPEND_USD),
  };
}

export function spendReservationMicros(mode: ChatModel, kind: UsageKind): UsdMicros {
  return reserveSpendCeilingMicros(mode, kind);
}

export type SpendReservationRow = {
  accepted: boolean;
  reserved_micros: number;
  user_remaining_micros: number;
  global_remaining_micros: number;
};
