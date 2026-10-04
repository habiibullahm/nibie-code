import "server-only";
import { randomUUID } from "node:crypto";

const safeRequestId = /^[A-Za-z0-9:_-]{8,200}$/;

export function resolveRequestId(header: string | null | undefined) {
  const value = header?.trim() ?? "";
  if (safeRequestId.test(value)) return value;
  return randomUUID();
}

export function requestIdFrom(request: Request) {
  return resolveRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
}
