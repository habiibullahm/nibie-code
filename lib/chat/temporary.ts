// Temporary chats: hidden from history, search and past-chat recall; never read or write Memory or thread summaries.
// The browser deletes one as soon as its owner leaves it. A tab that is simply closed never says so, so every temporary
// chat also carries an expiry, after which it is never shown and the cleanup sweep deletes it.

export const TEMPORARY_CHAT_TTL_MS = 24 * 60 * 60 * 1000;

export const temporaryChatUnavailable = "Temporary chats aren't available yet.";

export function temporaryChatExpiry(now: number = Date.now()): string {
  return new Date(now + TEMPORARY_CHAT_TTL_MS).toISOString();
}

/** True for a temporary chat, expired or not. */
export function isTemporaryConversation(row: { temporary_expires_at?: string | null } | null | undefined): boolean {
  return typeof row?.temporary_expires_at === "string" && row.temporary_expires_at.length > 0;
}

/** True for a temporary chat whose expiry has passed (or cannot be read): it is treated as already gone. */
export function isExpiredTemporaryConversation(row: { temporary_expires_at?: string | null } | null | undefined, now: number = Date.now()): boolean {
  if (!isTemporaryConversation(row)) return false;
  const expiresAt = Date.parse(row!.temporary_expires_at!);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
