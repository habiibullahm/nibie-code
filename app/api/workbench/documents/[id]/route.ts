import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { getWorkbenchDocument } from "@/lib/workbench/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  if (!await getAuthenticatedUser(supabase)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { id } = await context.params;
  const { document, error } = await getWorkbenchDocument(id);
  if (error) return NextResponse.json({ error }, { status: 503 });
  if (!document) return NextResponse.json({ error: "That document is no longer available." }, { status: 404 });
  return NextResponse.json({ document });
}
