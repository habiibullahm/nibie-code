import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { attachmentErrors } from "@/lib/attachments/rules";
import { attachmentsUnavailable, tooManyDrafts } from "@/lib/attachments/service";
import { abortAttachmentUpload, confirmAttachmentUpload, type AttachmentUploadClient } from "@/lib/attachments/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// PDF extract on a 10 MB upload can take a while; body stays tiny (JSON only).
export const maxDuration = 60;

const forbiddenFields = ["user_id", "userId", "message_id", "messageId", "conversation_id", "conversationId", "extracted_text", "extractedText"];

// After the browser PUTs bytes to Storage, download → extract → draft row → delete staging object.
// Pass `{ uploadId, abort: true }` to drop a staging object without extracting.
export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    if (origin && origin !== url.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if ([...url.searchParams.keys()].some((name) => forbiddenFields.includes(name))) {
      return NextResponse.json({ error: "Attachments use your session." }, { status: 400 });
    }

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: attachmentErrors.unavailable }, { status: 400 }); }
    if (!body || typeof body !== "object") return NextResponse.json({ error: attachmentErrors.unavailable }, { status: 400 });
    const record = body as Record<string, unknown>;
    if (forbiddenFields.some((name) => name in record)) return NextResponse.json({ error: "Attachments use your session." }, { status: 400 });
    const uploadId = typeof record.uploadId === "string" ? record.uploadId : "";
    if (!uploadId) return NextResponse.json({ error: attachmentErrors.unavailable }, { status: 400 });

    if (record.abort === true) {
      const aborted = await abortAttachmentUpload(supabase as unknown as AttachmentUploadClient, user.id, uploadId);
      if (aborted.error) return NextResponse.json({ error: aborted.error }, { status: 503 });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const confirmed = await confirmAttachmentUpload(supabase as unknown as AttachmentUploadClient, user.id, uploadId);
    if (confirmed.error || !confirmed.data) {
      const status = confirmed.error === attachmentErrors.tooLarge ? 413
        : confirmed.error === tooManyDrafts ? 409
        : confirmed.error === attachmentsUnavailable || confirmed.error === attachmentErrors.saveFailed ? 503
        : confirmed.error === attachmentErrors.unavailable ? 409
        : 400;
      return NextResponse.json({ error: confirmed.error ?? attachmentErrors.saveFailed }, { status });
    }
    return NextResponse.json({ attachment: confirmed.data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: attachmentErrors.saveFailed }, { status: 503 });
  }
}
