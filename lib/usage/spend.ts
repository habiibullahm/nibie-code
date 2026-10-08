import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatModel } from "@/lib/chat/validation";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { createActionAuditClient } from "@/lib/supabase/service-role";
import type { UsageKind } from "@/lib/usage/policy";
import {
  getSpendLimits,
  normalizeSpendReservationRow,
  spendReservationMicros,
} from "@/lib/usage/spend-policy";

export type SpendGuardResult =
  | { ok: true; reservedMicros: number }
  | { ok: false; status: 429 | 503; code?: string; error: string };

/**
 * Prefer SUPABASE_SERVICE_ROLE_KEY for spend RPCs; fall back to caller client (tests).
 * Browser/authenticated clients must never EXECUTE these RPCs.
 */
export function resolveAiSpendClient(preferred?: SupabaseClient): SupabaseClient | null {
  return createActionAuditClient() ?? preferred ?? null;
}

/**
 * Reserve against per-user daily + global hourly USD ceilings before an expensive provider call.
 * Distinct from weekly product credits — free credits must not bypass the dollar budget.
 */
export async function reserveGenerationSpend(input: {
  supabase: SupabaseClient;
  userId: string;
  generationId: string;
  mode: ChatModel;
  usageKind: UsageKind;
  requestId: string;
}): Promise<SpendGuardResult> {
  const client = resolveAiSpendClient(input.supabase);
  if (!client) {
    logError("ai_spend.reservation.failed", {
      requestId: input.requestId,
      logicalMode: input.mode,
      usageKind: input.usageKind,
      code: operationalCodes.requestFailed,
      reason: "missing_service_role",
    });
    return { ok: false, status: 503, error: "Nibie couldn't complete that response. Please try again." };
  }

  const limits = getSpendLimits();
  const reservedMicros = spendReservationMicros(input.mode, input.usageKind);
  const startedAt = Date.now();

  let row = null as ReturnType<typeof normalizeSpendReservationRow>;
  let rpcError: unknown = null;
  try {
    const result = await client
      .rpc("reserve_ai_spend", {
        p_user_id: input.userId,
        p_generation_id: input.generationId,
        p_reserved_micros: reservedMicros,
        p_user_daily_limit_micros: limits.userDailyUsdMicros,
        p_global_hourly_limit_micros: limits.globalHourlyUsdMicros,
      })
      .single();
    row = normalizeSpendReservationRow(result.data);
    rpcError = result.error;
  } catch (error) {
    rpcError = error;
  }

  if (rpcError || !row) {
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
  userId: string;
  generationId: string;
  actualMicros: number;
  requestId: string;
}): Promise<boolean> {
  const client = resolveAiSpendClient(input.supabase);
  if (!client) {
    logError("ai_spend.finalize.failed", {
      requestId: input.requestId,
      code: operationalCodes.requestFailed,
      reason: "missing_service_role",
    });
    return false;
  }
  try {
    const { data, error } = await client.rpc("finalize_ai_spend", {
      p_user_id: input.userId,
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
  userId: string;
  generationId: string;
  requestId: string;
}): Promise<void> {
  const client = resolveAiSpendClient(input.supabase);
  if (!client) {
    logError("ai_spend.reservation.release_failed", {
      requestId: input.requestId,
      code: operationalCodes.requestFailed,
      reason: "missing_service_role",
    });
    return;
  }
  try {
    const { error } = await client.rpc("release_ai_spend", {
      p_user_id: input.userId,
      p_generation_id: input.generationId,
    });
    if (error) logError("ai_spend.reservation.release_failed", { requestId: input.requestId, code: operationalCodes.requestFailed });
  } catch {
    logError("ai_spend.reservation.release_failed", { requestId: input.requestId, code: operationalCodes.requestFailed });
  }
}
