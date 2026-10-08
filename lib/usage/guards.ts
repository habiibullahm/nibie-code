import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatModel } from "@/lib/chat/validation";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { creditCostFor, WEEKLY_FREE_CREDIT_LIMIT, type UsageKind } from "@/lib/usage/policy";
import { finalizeGenerationSpend, releaseGenerationSpend, reserveGenerationSpend } from "@/lib/usage/spend";

export type WeeklyReservationRow = {
  accepted: boolean;
  credits_charged: number;
  credits_used: number;
  credits_remaining: number;
  reset_at: string;
};

export type UsageGuardOk = {
  ok: true;
  creditsCharged: number;
  creditsRemaining: number;
  resetAt: string;
  usageReservationMs: number;
  spendReservedMicros: number;
};

export type UsageGuardRejected = {
  ok: false;
  status: 429 | 503;
  code?: string;
  error: string;
  creditsRemaining?: number;
  resetAt?: string;
  release: () => Promise<void>;
};

/**
 * Server gate: weekly product credits AND dollar spend ceilings.
 * Expensive requests cannot silently bypass the configured cost budget.
 */
export async function reserveUsageBeforeGeneration(input: {
  supabase: SupabaseClient;
  userId: string;
  generationId: string;
  mode: ChatModel;
  usageKind: UsageKind;
  requestId: string;
}): Promise<UsageGuardOk | UsageGuardRejected> {
  const { supabase, userId, generationId, mode, usageKind, requestId } = input;
  const expectedCredits = creditCostFor(mode, usageKind);

  const releaseCredits = async () => {
    try {
      const { error } = await supabase.rpc("release_weekly_ai_usage", { p_generation_id: generationId });
      if (error) logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    } catch {
      logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    }
  };

  const releaseAll = async () => {
    await releaseGenerationSpend({ supabase, userId, generationId, requestId });
    await releaseCredits();
  };

  const reservationStartedAt = Date.now();
  let reservation: WeeklyReservationRow | null = null;
  let reservationError: unknown = null;
  try {
    const result = await supabase.rpc("reserve_weekly_ai_usage", {
      p_generation_id: generationId,
      p_logical_mode: mode,
      p_usage_kind: usageKind,
    }).single<WeeklyReservationRow>();
    reservation = result.data;
    reservationError = result.error;
  } catch {
    reservationError = new Error("Reservation request failed.");
  }
  const usageReservationMs = Date.now() - reservationStartedAt;

  if (
    reservationError
    || !reservation
    || typeof reservation.accepted !== "boolean"
    || !Number.isInteger(reservation.credits_remaining)
    || reservation.credits_remaining < 0
    || reservation.credits_remaining > WEEKLY_FREE_CREDIT_LIMIT
    || typeof reservation.reset_at !== "string"
    || !Number.isFinite(Date.parse(reservation.reset_at))
  ) {
    logError("weekly_usage.reservation.failed", { requestId, logicalMode: mode, usageKind, durationMs: usageReservationMs, code: operationalCodes.requestFailed });
    await releaseCredits();
    return {
      ok: false,
      status: 503,
      error: "Nibie couldn't complete that response. Please try again.",
      release: releaseAll,
    };
  }

  if (!reservation.accepted) {
    logWarn("weekly_usage.limit.rejected", {
      requestId,
      logicalMode: mode,
      usageKind,
      creditsCharged: 0,
      creditsRemaining: reservation.credits_remaining,
    });
    return {
      ok: false,
      status: 429,
      code: operationalCodes.weeklyUsageLimitRejected,
      error: "You've reached your weekly Nibie usage limit.",
      creditsRemaining: reservation.credits_remaining,
      resetAt: reservation.reset_at,
      release: releaseAll,
    };
  }

  if (reservation.credits_charged !== expectedCredits) {
    logError("weekly_usage.reservation.failed", {
      requestId,
      logicalMode: mode,
      usageKind,
      durationMs: usageReservationMs,
      reason: "policy_mismatch",
      code: operationalCodes.requestFailed,
    });
    await releaseCredits();
    return {
      ok: false,
      status: 503,
      error: "Nibie couldn't complete that response. Please try again.",
      release: releaseAll,
    };
  }

  logInfo("weekly_usage.reservation.accepted", {
    requestId,
    logicalMode: mode,
    usageKind,
    creditsCharged: reservation.credits_charged,
    creditsRemaining: reservation.credits_remaining,
    reservationLatencyMs: usageReservationMs,
  });

  const spend = await reserveGenerationSpend({
    supabase,
    userId,
    generationId,
    mode,
    usageKind,
    requestId,
  });
  if (!spend.ok) {
    await releaseCredits();
    return {
      ok: false,
      status: spend.status,
      code: spend.code,
      error: spend.error,
      release: releaseAll,
    };
  }

  return {
    ok: true,
    creditsCharged: reservation.credits_charged,
    creditsRemaining: reservation.credits_remaining,
    resetAt: reservation.reset_at,
    usageReservationMs,
    spendReservedMicros: spend.reservedMicros,
  };
}

export async function releaseWeeklyUsageHold(input: {
  supabase: SupabaseClient;
  generationId: string;
  requestId: string;
  logicalMode: ChatModel;
}) {
  try {
    const { error } = await input.supabase.rpc("release_weekly_ai_usage", { p_generation_id: input.generationId });
    if (error) {
      logError("weekly_usage.reservation.release_failed", {
        requestId: input.requestId,
        logicalMode: input.logicalMode,
        code: operationalCodes.requestFailed,
      });
    }
  } catch {
    logError("weekly_usage.reservation.release_failed", {
      requestId: input.requestId,
      logicalMode: input.logicalMode,
      code: operationalCodes.requestFailed,
    });
  }
}

export async function releaseUsageHold(input: {
  supabase: SupabaseClient;
  userId: string;
  generationId: string;
  requestId: string;
  logicalMode: ChatModel;
}) {
  await releaseGenerationSpend({
    supabase: input.supabase,
    userId: input.userId,
    generationId: input.generationId,
    requestId: input.requestId,
  });
  await releaseWeeklyUsageHold(input);
}

export async function startWeeklyUsage(input: {
  supabase: SupabaseClient;
  generationId: string;
  requestId: string;
  logicalMode: ChatModel;
}): Promise<boolean> {
  try {
    const { data, error } = await input.supabase.rpc("start_weekly_ai_usage", { p_generation_id: input.generationId });
    const ok = data === true && !error;
    if (!ok) logError("weekly_usage.start.failed", { requestId: input.requestId, logicalMode: input.logicalMode, code: operationalCodes.requestFailed });
    return ok;
  } catch {
    logError("weekly_usage.start.failed", { requestId: input.requestId, logicalMode: input.logicalMode, code: operationalCodes.requestFailed });
    return false;
  }
}

export { finalizeGenerationSpend, releaseGenerationSpend };
