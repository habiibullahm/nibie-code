import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatModel } from "@/lib/chat/validation";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import type { UsageKind } from "@/lib/usage/policy";
import { getSpendLimits, spendReservationMicros, type SpendReservationRow } from "@/lib/usage/spend-policy";

export type SpendGuardResult =
  | { ok: true; reservedMicros: number }
  | { ok: false; status: 429 | 503; code?: string; error: string };

/**
 * Reserve against per-user daily + global hourly USD ceilings before an expensive provider call.
 * Distinct from weekly product credits — free credits must not bypass the dollar budget.
 */
export async function reserveGenerationSpend(input: {
  supabase: SupabaseClient;
  generationId: string;
  mode: ChatModel;
  usageKind: UsageKind;
  requestId: string;
}): Promise<SpendGuardResult> {
  const limits = getSpendLimits();
  const reservedMicros = spendReservationMicros(input.mode, input.usageKind);
  const startedAt = Date.now();

  let row: SpendReservationRow | null = null;
  let rpcError: unknown = null;
  try {
    const result = await input.supabase
      .rpc("reserve_ai_spend", {
        p_generation_id: input.generationId,
        p_reserved_micros: reservedMicros,
        p_user_daily_limit_micros: limits.userDailyUsdMicros,
        p_global_hourly_limit_micros: limits.globalHourlyUsdMicros,
      })
      .single<SpendReservationRow>();
    row = result.data;
    rpcError = result.error;
  } catch (error) {
    rpcError = error;
  }

  if (rpcError || !row || typeof row.accepted !== "boolean") {
    logError("ai_spend.reservation.failed", {
      requestId: input.requestId,
      logicalMode: input.mode,
      usageKind: input.usageKind,
      durationMs: Date.now() - startedAt,
      code: operationalCodes.requestFailed,
    });
    return { ok: false, status: 503, error: "Nibie couldn't complete that response. Please try again." };
  }

  if (!row.accepted) {
    logWarn("ai_spend.limit.rejected", {
      requestId: input.requestId,
      logicalMode: input.mode,
      usageKind: input.usageKind,
      spendReservedMicros: 0,
      userRemainingMicros: row.user_remaining_micros,
      globalRemainingMicros: row.global_remaining_micros,
      code: operationalCodes.aiSpendLimitRejected,
    });
    return {
      ok: false,
      status: 429,
      code: operationalCodes.aiSpendLimitRejected,
      error: "Nibie has reached its AI spend budget for now. Please try again later.",
    };
  }

  logInfo("ai_spend.reservation.accepted", {
    requestId: input.requestId,
    logicalMode: input.mode,
    usageKind: input.usageKind,
    spendReservedMicros: row.reserved_micros,
    userRemainingMicros: row.user_remaining_micros,
    globalRemainingMicros: row.global_remaining_micros,
    durationMs: Date.now() - startedAt,
  });

  return { ok: true, reservedMicros: row.reserved_micros };
}

export async function finalizeGenerationSpend(input: {
  supabase: SupabaseClient;
  generationId: string;
  actualMicros: number;
  requestId: string;
}): Promise<boolean> {
  try {
    const { data, error } = await input.supabase.rpc("finalize_ai_spend", {
      p_generation_id: input.generationId,
      p_actual_micros: Math.max(0, Math.trunc(input.actualMicros)),
    });
    if (error || data !== true) {
      logError("ai_spend.finalize.failed", { requestId: input.requestId, code: operationalCodes.requestFailed });
      return false;
    }
    return true;
  } catch {
    logError("ai_spend.finalize.failed", { requestId: input.requestId, code: operationalCodes.requestFailed });
    return false;
  }
}

export async function releaseGenerationSpend(input: {
  supabase: SupabaseClient;
  generationId: string;
  requestId: string;
}): Promise<void> {
  try {
    const { error } = await input.supabase.rpc("release_ai_spend", { p_generation_id: input.generationId });
    if (error) logError("ai_spend.reservation.release_failed", { requestId: input.requestId, code: operationalCodes.requestFailed });
  } catch {
    logError("ai_spend.reservation.release_failed", { requestId: input.requestId, code: operationalCodes.requestFailed });
  }
}
