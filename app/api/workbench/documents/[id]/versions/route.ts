import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { listWorkbenchVersionsAction } from "@/app/actions/workbench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  if (!await getAuthenticatedUser(supabase)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { id } = await context.params;
  const result = await listWorkbenchVersionsAction(id);
  if (result.error) {
    const status = result.error.includes("no longer available") ? 404
      : result.error.includes("isn't available") ? 503
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ versions: result.data ?? [] });
}
