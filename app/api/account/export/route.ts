import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import {
  buildConversationExport,
  readAllPages,
  type ExportConversationRow,
  type ExportMessageRow,
} from "@/lib/privacy/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exportFailed = "Your conversations couldn't be exported. Please try again.";
const forbiddenUserParams = ["user_id", "userId", "user"];

type OrderedQuery = {
  order: (column: string, options: { ascending: boolean }) => OrderedQuery;
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

function owned(query: OrderedQuery, ...columns: string[]) {
  return columns.reduce((current, column) => current.order(column, { ascending: true }), query);
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if (forbiddenUserParams.some((name) => url.searchParams.has(name))) {
      return NextResponse.json({ error: "Export is limited to your account." }, { status: 400 });
    }

    const conversations = await readAllPages<ExportConversationRow>(async (from, to) => {
      const query = owned(
        supabase.from("conversations").select("id,title,selected_model,custom_instructions,created_at,updated_at").eq("user_id", user.id) as unknown as OrderedQuery,
        "created_at",
        "id",
      );
      const { data, error } = await query.range(from, to);
      return { data: data as ExportConversationRow[] | null, error };
    });
    const messages = conversations && await readAllPages<ExportMessageRow>(async (from, to) => {
      const query = owned(
        supabase.from("messages").select("id,conversation_id,role,content,status,position,created_at,reply_to_message_id").eq("user_id", user.id) as unknown as OrderedQuery,
        "conversation_id",
        "position",
        "id",
      );
      const { data, error } = await query.range(from, to);
      return { data: data as ExportMessageRow[] | null, error };
    });
    if (!conversations || !messages) return NextResponse.json({ error: exportFailed }, { status: 503 });

    const payload = buildConversationExport({ conversations, messages, exportedAt: new Date().toISOString() });
    if (!payload) return NextResponse.json({ error: exportFailed }, { status: 503 });

    return new NextResponse(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="nibie-export-v1.json"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: exportFailed }, { status: 503 });
  }
}
