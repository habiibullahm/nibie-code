import "server-only";

import { z } from "zod";
import { getModelOptions } from "@/lib/ai/registry";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { preferenceModelToChatModel } from "@/lib/preferences/model";
import { defaultUserPreferences, type PreferencePatch, type UserPreferences } from "@/lib/preferences/types";
import { parsePreferencePatch, preferenceModelSchema, preferredLanguageSchema, responseLengthSchema, responseStyleSchema } from "@/lib/preferences/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const preferenceColumns = "preferred_name,preferred_language,default_model,response_length,response_style,about_you,recall_enabled,created_at,updated_at";

const preferenceRowSchema = z.object({
  preferred_name: z.string().nullable(),
  preferred_language: preferredLanguageSchema,
  default_model: preferenceModelSchema,
  response_length: responseLengthSchema,
  response_style: responseStyleSchema,
  about_you: z.string().nullable(),
  recall_enabled: z.boolean().default(true),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export type PreferencesResult = {
  preferences: UserPreferences;
  error: string | null;
};

const loadError = "Settings couldn't be loaded. Refresh to try again.";
const saveError = "We couldn't save that change. Please try again.";
const sessionError = "Your session has expired. Please sign in again.";
const unavailableError = "Your session has expired or the service is unavailable. Please try again.";

function fromRow(row: z.infer<typeof preferenceRowSchema>): UserPreferences {
  return {
    preferredName: row.preferred_name,
    preferredLanguage: row.preferred_language,
    defaultModel: row.default_model,
    responseLength: row.response_length,
    responseStyle: row.response_style,
    aboutYou: row.about_you,
    recallEnabled: row.recall_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(userId: string, patch: PreferencePatch) {
  const row: Record<string, unknown> = { user_id: userId };
  if (patch.preferredName !== undefined) row.preferred_name = patch.preferredName;
  if (patch.preferredLanguage !== undefined) row.preferred_language = patch.preferredLanguage;
  if (patch.defaultModel !== undefined) row.default_model = patch.defaultModel;
  if (patch.responseLength !== undefined) row.response_length = patch.responseLength;
  if (patch.responseStyle !== undefined) row.response_style = patch.responseStyle;
  if (patch.aboutYou !== undefined) row.about_you = patch.aboutYou;
  if (patch.recallEnabled !== undefined) row.recall_enabled = patch.recallEnabled;
  return row;
}

// The signed-in session is the only owner. Callers cannot supply user_id, and the publishable-key client is what RLS checks.
type PreferenceReader = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Reads the signed-in owner's row. A missing row is the safe default, not an error.
export async function loadOwnerPreferences(supabase: PreferenceReader): Promise<PreferencesResult> {
  try {
    const { data, error } = await supabase.from("user_preferences").select(preferenceColumns).maybeSingle();
    if (error) return { preferences: defaultUserPreferences(), error: loadError };
    if (!data) return { preferences: defaultUserPreferences(), error: null };
    const parsed = preferenceRowSchema.safeParse(data);
    if (!parsed.success) return { preferences: defaultUserPreferences(), error: loadError };
    return { preferences: fromRow(parsed.data), error: null };
  } catch {
    return { preferences: defaultUserPreferences(), error: loadError };
  }
}

export async function readOwnerPreferences(): Promise<PreferencesResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return { preferences: defaultUserPreferences(), error: sessionError };
    return loadOwnerPreferences(supabase);
  } catch {
    return { preferences: defaultUserPreferences(), error: loadError };
  }
}

export async function writeOwnerPreferences(input: unknown): Promise<PreferencesResult> {
  const parsed = parsePreferencePatch(input);
  if ("error" in parsed) return { preferences: defaultUserPreferences(), error: parsed.error };
  if (parsed.data.defaultModel) {
    const mode = preferenceModelToChatModel[parsed.data.defaultModel];
    const available = getModelOptions().models.some((option) => option.id === mode);
    if (!available) return { preferences: defaultUserPreferences(), error: "That model isn't available." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return { preferences: defaultUserPreferences(), error: sessionError };
    const { data, error } = await supabase
      .from("user_preferences")
      .upsert(toRow(user.id, parsed.data), { onConflict: "user_id" })
      .select(preferenceColumns)
      .single();
    if (error || !data) return { preferences: defaultUserPreferences(), error: saveError };
    const row = preferenceRowSchema.safeParse(data);
    if (!row.success) return { preferences: defaultUserPreferences(), error: saveError };
    return { preferences: fromRow(row.data), error: null };
  } catch {
    return { preferences: defaultUserPreferences(), error: unavailableError };
  }
}
