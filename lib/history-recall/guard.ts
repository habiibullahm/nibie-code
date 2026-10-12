import "server-only";

export const HISTORY_RECALL_RATE = { perMinute: 6, windowMs: 60_000, trackedOwners: 1024 } as const;

/** Bounded process-local defense, alongside the DB's per-thread generation claim.
 * A distributed account-wide limiter remains an infrastructure requirement.
 */
export function createHistoryRecallGuard() {
  const owners = new Map<string, { starts: number[]; active: boolean }>();
  return {
    acquire(ownerId: string, now = Date.now()): { ok: true; release: () => void } | { ok: false; reason: "busy" | "rate_limited" } {
      for (const [id, state] of owners) {
        state.starts = state.starts.filter((time) => now - time < HISTORY_RECALL_RATE.windowMs);
        if (!state.active && !state.starts.length) owners.delete(id);
      }
      const state = owners.get(ownerId) ?? { starts: [], active: false };
      if (!ownerId || state.active) return { ok: false, reason: "busy" };
      if (state.starts.length >= HISTORY_RECALL_RATE.perMinute || (!owners.has(ownerId) && owners.size >= HISTORY_RECALL_RATE.trackedOwners)) {
        return { ok: false, reason: "rate_limited" };
      }
      state.starts.push(now);
      state.active = true;
      owners.set(ownerId, state);
      return { ok: true, release: () => { state.active = false; } };
    },
  };
}

export const historyRecallGuard = createHistoryRecallGuard();
