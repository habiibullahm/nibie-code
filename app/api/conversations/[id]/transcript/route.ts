import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { readAllPages } from "@/lib/privacy/export";
import { validateConversationId } from "@/lib/chat/validation";
import {
  TRANSCRIPT_LOAD_ERROR,
  TRANSCRIPT_MAX_MESSAGES,
  TRANSCRIPT_NOT_FOUND_ERROR,
  TRANSCRIPT_PAGE_SIZE,
  buildTranscriptText,
  type TranscriptMessageInput,
} from "@/lib/chat/transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbiddenUserParams = ["user_id", "userId", "user"];

type OrderedQuery = {
  order: (column: string, options: { ascending: boolean }) => OrderedQuery;
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

function owned(query: OrderedQuery, ...columns: string[]) {
  return columns.reduce((current, column) => current.order(column, { ascending: true }), query);
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Owner-scoped plain-text transcript for clipboard copy. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return jsonError("Authentication required.", 401);

    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return jsonError("Invalid request origin.", 403);
    if (forbiddenUserParams.some((name) => url.searchParams.has(name))) {
      return jsonError("Transcript is limited to your account.", 400);
    }

    const { id } = await context.params;
    const parsedId = validateConversationId(id);
    if (!parsedId.success) return jsonError("Choose a valid conversation.", 400);

    const format = url.searchParams.get("format");
    if (format != null && format !== "" && format !== "plain") {
      return jsonError("Unsupported transcript format.", 400);
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id,title,archived_at")
      .eq("id", parsedId.data)
      .eq("user_id", user.id)
      .maybeSingle();

    if (conversationError) return jsonError(TRANSCRIPT_LOAD_ERROR, 503);
    if (!conversation) return jsonError(TRANSCRIPT_NOT_FOUND_ERROR, 404);

    const messages = await readAllPages<TranscriptMessageInput & { id: string }>(async (from, to) => {
      const query = owned(
        supabase
          .from("messages")
          .select("id,role,content,status,position,created_at")
          .eq("conversation_id", parsedId.data)
          .eq("user_id", user.id) as unknown as OrderedQuery,
        "position",
        "id",
      );
      const { data, error } = await query.range(from, to);
      return { data: data as (TranscriptMessageInput & { id: string })[] | null, error };
    }, TRANSCRIPT_PAGE_SIZE);

    if (!messages) return jsonError(TRANSCRIPT_LOAD_ERROR, 503);
    if (messages.length > TRANSCRIPT_MAX_MESSAGES) {
      return jsonError("This conversation is too large to export as a transcript.", 413);
    }

    const built = buildTranscriptText(
      { id: conversation.id, title: conversation.title ?? "Untitled conversation" },
      messages,
      "plain",
    );
    if ("error" in built) return jsonError(built.error, built.status);

    return new NextResponse(built.text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return jsonError(TRANSCRIPT_LOAD_ERROR, 503);
  }
}
