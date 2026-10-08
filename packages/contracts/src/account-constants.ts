export const EXPORT_PRODUCT = "Nibie" as const;
export const EXPORT_VERSION = 2 as const;
export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_FILENAME = "nibie-export-v2.json" as const;

// Exact phrase, after trimming surrounding whitespace. Other casings do not confirm.
export const DELETE_ALL_CONFIRMATION = "DELETE";

// supabase.auth.signOut defaults to this scope: every refresh token for the account is revoked, on every device.
// Callers pass it explicitly so a later SDK default cannot silently narrow the session.
export const SIGN_OUT_SCOPE = "global" as const;

export function isDeleteAllConfirmed(value: unknown): value is typeof DELETE_ALL_CONFIRMATION {
  return typeof value === "string" && value.trim() === DELETE_ALL_CONFIRMATION;
}
