import { NextResponse } from "next/server";
import { stopChatResponseAction } from "@/app/actions/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stop acknowledgement is a route, not a Server Action: Next dispatches Server Actions one at a time per client,
// so a slow acknowledgement would hold the next message's save behind it. The action body only does owner-scoped work.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return NextResponse.json({ error: "A JSON request is required." }, { status: 415 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const value = body as { conversationId?: unknown; userMessageId?: unknown; assistantId?: unknown; content?: unknown } | null;
  // `content` is the exact reply text the user saw when they pressed Stop; the reply keeps it.
  const result = await stopChatResponseAction(value?.conversationId, value?.userMessageId, value?.assistantId, value?.content);
  return result.error ? NextResponse.json({ error: result.error }, { status: 503 }) : NextResponse.json({});
}
