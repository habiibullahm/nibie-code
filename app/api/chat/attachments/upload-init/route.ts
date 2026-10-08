import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { attachmentErrors } from "@/lib/attachments/rules";
import { attachmentsUnavailable, tooManyDrafts } from "@/lib/attachments/service";
import { initAttachmentUpload, type AttachmentUploadClient } from "@/lib/attachments/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbiddenFields = ["user_id", "userId", "message_id", "messageId", "conversation_id", "conversationId", "extracted_text", "extractedText", "path", "storage_path", "storagePath"];

// Authenticated upload-init: server-generated path + signed TUS token. No file bytes in this request.
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
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 }); }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
    const record = body as Record<string, unknown>;
    if (forbiddenFields.some((name) => name in record)) return NextResponse.json({ error: "Attachments use your session." }, { status: 400 });
    const name = typeof record.name === "string" ? record.name : "";
    const type = typeof record.type === "string" ? record.type : "";
    const size = typeof record.size === "number" ? record.size : Number(record.size);
    if (!name || !Number.isFinite(size)) return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });

    const created = await initAttachmentUpload(supabase as unknown as AttachmentUploadClient, user.id, { name, size, type });
    if (created.error || !created.data) {
      const status = created.error === attachmentErrors.tooLarge ? 413
        : created.error === tooManyDrafts ? 409
        : created.error === attachmentsUnavailable ? 503
        : created.error === attachmentErrors.saveFailed ? 503
        : 400;
      return NextResponse.json({ error: created.error ?? attachmentErrors.saveFailed }, { status });
    }
    return NextResponse.json({ upload: created.data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: attachmentErrors.saveFailed }, { status: 503 });
  }
}
