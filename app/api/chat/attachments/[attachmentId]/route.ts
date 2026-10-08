import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { validateConversationId } from "@/lib/chat/validation";
import { deleteDraftAttachment, type AttachmentClient } from "@/lib/attachments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Removes an unsent draft before the message is sent. Sent attachments are not removable on their own.
export async function DELETE(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const parsed = validateConversationId((await context.params).attachmentId);
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid attachment." }, { status: 400 });
    const removed = await deleteDraftAttachment(supabase as unknown as AttachmentClient, user.id, parsed.data);
    return removed.error ? NextResponse.json({ error: removed.error }, { status: 503 }) : NextResponse.json({});
  } catch {
    return NextResponse.json({ error: "We couldn't remove that attachment. Please try again." }, { status: 503 });
  }
}
