import { NextResponse } from "next/server";
import { publicHealthRelease } from "@/lib/observability/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicHealthRelease(), {
    headers: { "cache-control": "no-store" },
  });
}
