import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { validateConversationId } from "@/lib/chat/validation";
import { attachmentErrors } from "@/lib/attachments/rules";
import { attachmentsUnavailable } from "@/lib/attachments/service";
import { createAttachmentDownloadUrl, type AttachmentUploadClient } from "@/lib/attachments/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner-only download of a sent attachment's original bytes via a short-lived signed Storage URL.
// Cookie session + RLS; no service role; non-owners see the same unavailable response as a missing file.
export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const parsed = validateConversationId((await context.params).attachmentId);
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid attachment." }, { status: 400 });

    const result = await createAttachmentDownloadUrl(supabase as unknown as AttachmentUploadClient, user.id, parsed.data);
    if (result.error || !result.url) {
      const status = result.error === attachmentsUnavailable ? 503
        : result.error === attachmentErrors.saveFailed ? 503
        : 404;
      return NextResponse.json({ error: result.error ?? attachmentErrors.unavailable }, { status });
    }

    return NextResponse.redirect(result.url, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return NextResponse.json({ error: attachmentErrors.unavailable }, { status: 503 });
  }
}
