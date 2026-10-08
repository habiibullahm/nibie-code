import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/config/supabase";

/**
 * Server-only Supabase client for privileged Action audit RPCs.
 * Never import from client components. Never put this key in NEXT_PUBLIC_*.
 */
export function createActionAuditClient(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SupabaseClient | null {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  // Reject accidental use of a publishable/anon key in the service-role slot.
  if (!isServiceRoleMaterial(key)) return null;

  let url: string;
  try {
    url = getSupabasePublicConfig(env).url;
  } catch {
    const fallback = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!fallback) return null;
    url = fallback;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function isServiceRoleMaterial(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown };
    return claims.role === "service_role";
  } catch {
    return false;
  }
}
