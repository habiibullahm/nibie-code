import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WEEKLY_FREE_CREDIT_LIMIT } from "@/lib/usage/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const { data, error } = await supabase.rpc("get_current_weekly_ai_usage").maybeSingle<{
      credits_used: number;
      credits_remaining: number;
      reset_at: string;
    }>();
    if (error || !data || !Number.isInteger(data.credits_used) || data.credits_used < 0 || data.credits_used > WEEKLY_FREE_CREDIT_LIMIT
      || !Number.isInteger(data.credits_remaining) || data.credits_remaining < 0 || data.credits_remaining > WEEKLY_FREE_CREDIT_LIMIT
      || data.credits_used + data.credits_remaining !== WEEKLY_FREE_CREDIT_LIMIT
      || typeof data.reset_at !== "string" || !Number.isFinite(Date.parse(data.reset_at))) {
      return NextResponse.json({ error: "Weekly usage is unavailable." }, { status: 503 });
    }
    return NextResponse.json({ creditsUsed: data.credits_used, creditsRemaining: data.credits_remaining, resetAt: data.reset_at }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Weekly usage is unavailable." }, { status: 503 });
  }
}
