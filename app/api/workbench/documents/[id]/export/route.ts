import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { getWorkbenchDocument } from "@/lib/workbench/read";
import {
  parseWorkbenchExportFormat,
  workbenchExportContentDisposition,
  workbenchExportFilename,
  workbenchMarkdownExportBody,
  workbenchPlainExportBody,
} from "@/lib/workbench/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  if (!await getAuthenticatedUser(supabase)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const format = parseWorkbenchExportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) {
    return NextResponse.json({ error: "Choose a Markdown (.md) or plain text (.txt) export." }, { status: 400 });
  }
  const { id } = await context.params;
  const { document, error } = await getWorkbenchDocument(id);
  if (error) return NextResponse.json({ error }, { status: 503 });
  if (!document) return NextResponse.json({ error: "That document is no longer available." }, { status: 404 });

  const safeContent = sanitizeModelOutput(document.content).text;
  const body = format === "md"
    ? workbenchMarkdownExportBody(document.title, safeContent)
    : workbenchPlainExportBody(safeContent);
  const filename = workbenchExportFilename(document.title, format);
  const contentType = format === "md"
    ? "text/markdown; charset=utf-8"
    : "text/plain; charset=utf-8";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": workbenchExportContentDisposition(filename),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
