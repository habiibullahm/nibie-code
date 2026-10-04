export function weeklyLimitNotice(resetAt: string, locale?: string, timeZone?: string): string {
  const reset = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone,
  }).format(new Date(resetAt));
  return `You've reached your weekly Nibie usage limit. Your allowance resets ${reset}.`;
}
