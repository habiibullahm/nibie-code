import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { searchOwnedChats } from "@/lib/chat/search-owned";
import { SEARCH_MAX_QUERY } from "@/lib/chat/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbiddenFields = ["user_id", "userId"];

// Authenticated, owner-scoped conversation + message search. Cancelable from the client via AbortSignal.
export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    if (origin && origin !== url.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if ([...url.searchParams.keys()].some((name) => forbiddenFields.includes(name))) {
      return NextResponse.json({ error: "Search uses your session." }, { status: 400 });
    }

    const raw = url.searchParams.get("q") ?? "";
    if (raw.length > SEARCH_MAX_QUERY + 32) {
      return NextResponse.json({ error: "Search query is too long." }, { status: 400 });
    }

    const result = await searchOwnedChats(supabase, raw);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ error: "Search is temporarily unavailable." }, { status: 503 });
  }
}
