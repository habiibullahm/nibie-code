import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { attachmentErrors } from "@/lib/attachments/rules";
import { attachmentsUnavailable, tooManyDrafts } from "@/lib/attachments/service";
import { cancelAttachmentUpload, finalizeAttachmentUpload, type AttachmentUploadClient } from "@/lib/attachments/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const forbiddenFields = ["user_id", "userId", "message_id", "messageId", "conversation_id", "conversationId", "extracted_text", "extractedText", "path", "storage_path", "storagePath"];

// Authenticated finalize: verify owner/path/size → extract (24k) → draft → delete staging.
// Pass `{ uploadId, cancel: true }` (or abort: true) to drop staging without extracting.
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

    if (record.cancel === true || record.abort === true) {
      const cancelled = await cancelAttachmentUpload(supabase as unknown as AttachmentUploadClient, user.id, uploadId);
      if (cancelled.error) return NextResponse.json({ error: cancelled.error }, { status: 503 });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const finalized = await finalizeAttachmentUpload(supabase as unknown as AttachmentUploadClient, user.id, uploadId);
    if (finalized.error || !finalized.data) {
      const status = finalized.error === attachmentErrors.tooLarge ? 413
        : finalized.error === tooManyDrafts ? 409
        : finalized.error === attachmentsUnavailable || finalized.error === attachmentErrors.saveFailed ? 503
        : finalized.error === attachmentErrors.unavailable ? 409
        : 400;
      return NextResponse.json({ error: finalized.error ?? attachmentErrors.saveFailed }, { status });
    }
    return NextResponse.json({ attachment: finalized.data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: attachmentErrors.saveFailed }, { status: 503 });
  }
}
