import { NextResponse } from "next/server";
import { createActionAuditClient } from "@/lib/supabase/service-role";
import { logError, logInfo } from "@/lib/observability/logger";
import { requestIdFrom } from "@/lib/observability/request-id";
import { operationalCodes } from "@/lib/observability/codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deletes every temporary chat whose expiry has passed (see lib/chat/temporary.ts). Leaving a temporary chat already
 * deletes it; this catches the ones whose tab was simply closed. Messages, attachments and usage rows go through the
 * conversation cascade. Expired chats are hidden everywhere even before this runs.
 * Auth: Authorization Bearer must match CRON_SECRET (never logged). Requires SUPABASE_SERVICE_ROLE_KEY.
 */
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    logError("temporary_chat.purge.misconfigured", { requestId, code: operationalCodes.requestFailed, reason: "missing_cron_secret" });
    return NextResponse.json({ error: "Cleanup is not configured." }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!presented || presented !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createActionAuditClient();
  if (!supabase) {
    logError("temporary_chat.purge.misconfigured", { requestId, code: operationalCodes.requestFailed, reason: "missing_service_role" });
    return NextResponse.json({ error: "Cleanup is not configured." }, { status: 503 });
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .lt("temporary_expires_at", new Date().toISOString())
      .select("id");
    if (error) {
      logError("temporary_chat.purge.failed", { requestId, code: operationalCodes.requestFailed });
      return NextResponse.json({ error: "Cleanup failed." }, { status: 503 });
    }
    const deleted = data?.length ?? 0;
    logInfo("temporary_chat.purge.completed", { requestId, deleted });
    return NextResponse.json({ ok: true, deleted });
  } catch {
    logError("temporary_chat.purge.failed", { requestId, code: operationalCodes.requestFailed });
    return NextResponse.json({ error: "Cleanup failed." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
