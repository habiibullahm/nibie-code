import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments/limits";
import { attachmentErrors } from "@/lib/attachments/rules";
import { attachmentsUnavailable, saveDraftAttachment, tooManyDrafts, type AttachmentClient } from "@/lib/attachments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ownership comes from the session; a request can never name an owner, a message, or stored text.
const forbiddenFields = ["user_id", "userId", "message_id", "messageId", "conversation_id", "conversationId", "extracted_text", "extractedText"];
// Multipart framing around one file.
const formOverheadBytes = 64 * 1024;

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    if (origin && origin !== url.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if ([...url.searchParams.keys()].some((name) => forbiddenFields.includes(name))) return NextResponse.json({ error: "Attachments use your session." }, { status: 400 });
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_ATTACHMENT_BYTES + formOverheadBytes) return NextResponse.json({ error: attachmentErrors.tooLarge }, { status: 413 });

    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 }); }
    if (forbiddenFields.some((name) => form.has(name))) return NextResponse.json({ error: "Attachments use your session." }, { status: 400 });
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
    const file = files[0];
    if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: attachmentErrors.tooLarge }, { status: 413 });
    const saved = await saveDraftAttachment(supabase as unknown as AttachmentClient, user.id, { filename: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (saved.error || !saved.data) {
      const status = saved.error === attachmentErrors.saveFailed ? 503 : saved.error === attachmentsUnavailable ? 503 : saved.error === tooManyDrafts ? 409 : 400;
      return NextResponse.json({ error: saved.error ?? attachmentErrors.saveFailed }, { status });
    }
    return NextResponse.json({ attachment: saved.data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: attachmentErrors.saveFailed }, { status: 503 });
  }
}
