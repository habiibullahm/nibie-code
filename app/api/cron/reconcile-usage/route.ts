import { NextResponse } from "next/server";
import { createActionAuditClient } from "@/lib/supabase/service-role";
import { logError, logInfo } from "@/lib/observability/logger";
import { requestIdFrom } from "@/lib/observability/request-id";
import { operationalCodes } from "@/lib/observability/codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_STALE_SECONDS = 900;

/**
 * Failure-safe quota reconciliation for crashed/stuck generation holds.
 * Auth: Authorization Bearer must match CRON_SECRET (never logged).
 * Requires SUPABASE_SERVICE_ROLE_KEY for reconcile_stale_ai_usage.
 */
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    logError("usage.reconcile.misconfigured", { requestId, code: operationalCodes.requestFailed, reason: "missing_cron_secret" });
    return NextResponse.json({ error: "Reconciliation is not configured." }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!presented || presented !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let staleAfterSeconds = DEFAULT_STALE_SECONDS;
  try {
    const body = (await request.json().catch(() => null)) as { staleAfterSeconds?: unknown } | null;
    if (typeof body?.staleAfterSeconds === "number" && Number.isInteger(body.staleAfterSeconds)) {
      staleAfterSeconds = body.staleAfterSeconds;
    }
  } catch {
    /* empty body is fine */
  }
  if (staleAfterSeconds < 60 || staleAfterSeconds > 86_400) {
    return NextResponse.json({ error: "Invalid stale window." }, { status: 400 });
  }

  const supabase = createActionAuditClient();
  if (!supabase) {
    logError("usage.reconcile.misconfigured", { requestId, code: operationalCodes.requestFailed, reason: "missing_service_role" });
    return NextResponse.json({ error: "Reconciliation is not configured." }, { status: 503 });
  }

  try {
    const { data, error } = await supabase
      .rpc("reconcile_stale_ai_usage", { p_stale_after_seconds: staleAfterSeconds })
      .single<{ weekly_released: number; spend_released: number }>();
    if (error || !data) {
      logError("usage.reconcile.failed", { requestId, code: operationalCodes.requestFailed });
      return NextResponse.json({ error: "Reconciliation failed." }, { status: 503 });
    }
    logInfo("usage.reconcile.completed", {
      requestId,
      weeklyReleased: data.weekly_released,
      spendReleased: data.spend_released,
      staleAfterSeconds,
    });
    return NextResponse.json({
      ok: true,
      weeklyReleased: data.weekly_released,
      spendReleased: data.spend_released,
      staleAfterSeconds,
    });
  } catch {
    logError("usage.reconcile.failed", { requestId, code: operationalCodes.requestFailed });
    return NextResponse.json({ error: "Reconciliation failed." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
