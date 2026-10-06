import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { backfillRoomFileEmbeddings } from "@/lib/files/search";
import { validateConversationId } from "@/lib/chat/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BATCH_LIMIT = 20;

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const { roomId } = await context.params;
    const parsedRoom = validateConversationId(roomId);
    if (!parsedRoom.success) return NextResponse.json({ error: "Choose a valid room." }, { status: 400 });

    const { data: room, error: roomError } = await supabase.from("rooms").select("id").eq("id", parsedRoom.data).maybeSingle();
    if (roomError) return NextResponse.json({ error: "Embeddings are unavailable. Please try again." }, { status: 503 });
    if (!room) return NextResponse.json({ error: "That room is no longer available." }, { status: 404 });

    const processed = await backfillRoomFileEmbeddings(supabase, parsedRoom.data, BATCH_LIMIT);
    if (!Number.isInteger(processed) || processed < 0 || processed > BATCH_LIMIT) {
      return NextResponse.json({ error: "Embeddings are unavailable. Please try again." }, { status: 503 });
    }
    return NextResponse.json({ processed, limit: BATCH_LIMIT }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Embeddings are unavailable. Please try again." }, { status: 503 });
  }
}
