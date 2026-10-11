#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Validate the migration target without connecting or reporting credentials.
 * @param {Record<string, string | undefined>} [env]
 */
export function assertPreviewDatabaseTarget(env = process.env) {
  const previewRef = env.PREVIEW_SUPABASE_PROJECT_REF;
  const productionRef = env.PRODUCTION_SUPABASE_PROJECT_REF;
  const projectRef = /^[a-z0-9]{20}$/;
  if (!previewRef || !productionRef || !projectRef.test(previewRef) || !projectRef.test(productionRef)) {
    throw new Error("Set valid PREVIEW_SUPABASE_PROJECT_REF and PRODUCTION_SUPABASE_PROJECT_REF repository variables.");
  }
  if (previewRef === productionRef) {
    throw new Error("Preview and Production must use different Supabase projects.");
  }
  if (!env.PREVIEW_DATABASE_URL) {
    throw new Error("Set PREVIEW_POSTGRES_URL_NON_POOLING on the GitHub preview environment; production fallback is forbidden.");
  }

  let url;
  let username;
  try {
    url = new URL(env.PREVIEW_DATABASE_URL);
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error("The Preview migration connection is invalid.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || (url.port && url.port !== "5432") || url.pathname !== "/postgres" || !url.password) {
    throw new Error("Preview migrations require a password-authenticated Postgres direct/session connection to postgres on port 5432.");
  }

  const direct = url.hostname === `db.${previewRef}.supabase.co` && username === "postgres";
  const sessionPooler = url.hostname.endsWith(".pooler.supabase.com") && username === `postgres.${previewRef}`;
  if (!direct && !sessionPooler) {
    throw new Error("The migration connection does not identify the configured Preview Supabase project.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertPreviewDatabaseTarget();
    console.log("Preview migration target verified; production fallback is disabled.");
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
