import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Multipart upload through this Function is retired (Vercel ≈4.5 MB body limit).
// Use upload-init → TUS → finalize.
export async function POST() {
  return NextResponse.json(
    { error: "Use /api/chat/attachments/upload-init, then finalize after the direct upload." },
    { status: 410 },
  );
}
