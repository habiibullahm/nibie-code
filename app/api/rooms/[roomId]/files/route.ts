import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { validateConversationId } from "@/lib/chat/validation";
import { saveRoomFile, type RoomFileClient } from "@/lib/files/service";
import { MAX_FILE_BYTES } from "@/lib/files/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbiddenFields = ["user_id", "userId", "storage_path", "storagePath", "extracted_text", "extractedText"];

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    if (origin && origin !== url.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if ([...url.searchParams.keys()].some((name) => forbiddenFields.includes(name))) {
      return NextResponse.json({ error: "File access uses your session." }, { status: 400 });
    }
    const { roomId } = await context.params;
    const parsedRoom = validateConversationId(roomId);
    if (!parsedRoom.success) return NextResponse.json({ error: "Choose a valid room." }, { status: 400 });

    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Choose a file to add." }, { status: 400 }); }
    if (forbiddenFields.some((name) => form.has(name))) return NextResponse.json({ error: "File access uses your session." }, { status: 400 });
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to add." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "That file is larger than 5 MB." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await saveRoomFile(supabase as unknown as RoomFileClient, user.id, parsedRoom.data, {
      filename: file.name,
      mimeType: file.type,
      bytes,
    });
    if (saved.error || !saved.data) {
      const status = saved.error === "That room is no longer available." ? 404 : saved.error === "This room already has 20 files." || saved.error?.startsWith("That file") || saved.error?.startsWith("Use a") || saved.error?.startsWith("Choose a") ? 400 : 503;
      return NextResponse.json({ error: saved.error ?? "We couldn't save that file. Please try again." }, { status });
    }
    return NextResponse.json({ file: saved.data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "We couldn't save that file. Please try again." }, { status: 503 });
  }
}
