"use client";

import { useEffect, useState } from "react";
import { WEEKLY_FREE_CREDIT_LIMIT } from "@/lib/usage/policy";

type UsageResponse = { creditsUsed: number; creditsRemaining: number; resetAt: string };

export function WeeklyUsageSummary({ preview }: { preview: boolean }) {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    const controller = new AbortController();
    fetch("/api/usage", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("usage unavailable");
        const result = await response.json() as UsageResponse;
        if (!Number.isInteger(result.creditsUsed) || result.creditsUsed < 0 || result.creditsUsed > WEEKLY_FREE_CREDIT_LIMIT
          || !Number.isInteger(result.creditsRemaining) || result.creditsRemaining < 0 || result.creditsRemaining > WEEKLY_FREE_CREDIT_LIMIT
          || result.creditsUsed + result.creditsRemaining !== WEEKLY_FREE_CREDIT_LIMIT || !Number.isFinite(Date.parse(result.resetAt))) throw new Error("invalid usage response");
        if (!cancelled) setUsage(result);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; controller.abort(); };
  }, [preview, attempt]);

  if (preview) return <p className="settings-note">Weekly usage is available in your signed-in account.</p>;
  if (failed) return <p className="settings-note" role="status">Weekly usage couldn’t be loaded. <button className="settings-save" type="button" onClick={() => { setFailed(false); setUsage(null); setAttempt((value) => value + 1); }}>Try again</button></p>;
  if (!usage) return <p className="settings-note" role="status">Loading weekly usage…</p>;

  const reset = new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(usage.resetAt));
  return <div className="weekly-usage-summary" role="status" aria-live="polite">
    <p>{usage.creditsRemaining} credits left this week.</p>
    <p>{usage.creditsUsed} of {WEEKLY_FREE_CREDIT_LIMIT} credits used.</p>
    <progress max={WEEKLY_FREE_CREDIT_LIMIT} value={usage.creditsUsed} aria-label="Weekly credits used" />
    {usage.creditsRemaining === 0 ? <p>Your allowance resets {reset}.</p> : <p>Resets {reset}.</p>}
    <p className="settings-note">Fast uses 1 credit · Balanced 3 · High 6 per generation.</p>
  </div>;
}
