import "server-only";

/** Process-local guard: one in-flight backfill per user and a rolling batch budget. */
export const BACKFILL_WINDOW_MS = 60_000;
export const BACKFILL_MAX_BATCHES_PER_WINDOW = 6;

const inFlight = new Set<string>();
const startedAt = new Map<string, number[]>();

function prune(userId: string, now: number) {
  const recent = (startedAt.get(userId) ?? []).filter((at) => now - at < BACKFILL_WINDOW_MS);
  if (recent.length) startedAt.set(userId, recent);
  else startedAt.delete(userId);
  return recent;
}

export type BackfillSlot = { ok: true } | { ok: false; reason: "busy" | "rate_limited" };

/** Acquire before calling OpenAI. Caller must always release. */
export function acquireBackfillSlot(userId: string, now = Date.now()): BackfillSlot {
  if (!userId || inFlight.has(userId)) return { ok: false, reason: "busy" };
  const recent = prune(userId, now);
  if (recent.length >= BACKFILL_MAX_BATCHES_PER_WINDOW) return { ok: false, reason: "rate_limited" };
  inFlight.add(userId);
  return { ok: true };
}

/** Release after the attempt. `consumed` counts against the rolling window when work started. */
export function releaseBackfillSlot(userId: string, consumed: boolean, now = Date.now()) {
  inFlight.delete(userId);
  if (!consumed || !userId) return;
  const recent = prune(userId, now);
  recent.push(now);
  startedAt.set(userId, recent);
}

/** Test helper only. */
export function resetBackfillGuardForTests() {
  inFlight.clear();
  startedAt.clear();
}
