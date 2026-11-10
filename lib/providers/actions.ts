"use server";

import { z } from "zod";
import { assertProviderBaseUrl } from "@/lib/ai/provider-url";
import { listProviderModels, testProviderConnection } from "@/lib/ai/provider-directory";
import { ProviderRequestError } from "@/lib/ai/provider-error";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { providerPublicColumns } from "@/lib/providers/columns";
import { parseProviderWrite } from "@/lib/providers/validation";

export type PublicProviderConfig = {
  id: string;
  providerType: "nibie_router" | "openai_compatible";
  name: string;
  baseUrl: string;
  keyHint: string;
  isDefault: boolean;
};

type ProviderRow = {
  id: string;
  provider_type: PublicProviderConfig["providerType"];
  name: string;
  base_url: string;
  key_hint: string;
  is_default: boolean;
};

type DbError = { code?: string; message?: string } | null;

const sessionError = "Your session has expired or the service is unavailable. Please try again.";
const saveFailed = "We couldn't save that change. Please try again.";
const modelId = /^[A-Za-z0-9._:/-]{1,128}$/;
const directoryInput = z.object({
  configId: z.string().uuid().optional(),
  providerType: z.enum(["nibie_router", "openai_compatible"]).optional(),
  baseUrl: z.string().trim().min(8).max(300).optional(),
  apiKey: z.string().trim().min(1).max(400).optional(),
  model: z.string().trim().optional(),
});

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error(sessionError);
  return { supabase, user };
}

function toPublic(row: ProviderRow): PublicProviderConfig {
  return {
    id: row.id,
    providerType: row.provider_type,
    name: row.name,
    baseUrl: row.base_url,
    keyHint: row.key_hint,
    isDefault: row.is_default,
  };
}

function keyHint(apiKey: string) {
  const hint = apiKey.slice(-4);
  return hint.length >= 2 ? hint : apiKey.padEnd(2, apiKey).slice(0, 4);
}

function providerWriteError(error: DbError, fallback = saveFailed) {
  const message = error?.message ?? "";
  if (message.includes("provider cap")) return "You can save up to 10 providers.";
  if (error?.code === "23505") return "Could not update the default provider. Try again.";
  if (error?.code === "23514") return "Use HTTPS and a public host.";
  return fallback;
}

function secretFailure(error: unknown) {
  if (error instanceof Error && error.message.includes("PROVIDER_SECRET_KEY")) return "Provider secrets are not configured.";
  return "The provider key could not be saved.";
}

export async function listProviderConfigsAction(): Promise<{ data?: PublicProviderConfig[]; error?: string }> {
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("provider_configs").select(providerPublicColumns).order("updated_at", { ascending: false });
    if (error) return { error: saveFailed };
    return { data: ((data ?? []) as ProviderRow[]).map(toPublic) };
  } catch {
    return { error: sessionError };
  }
}

export async function saveProviderConfigAction(input: unknown): Promise<{ data?: PublicProviderConfig; error?: string }> {
  const parsed = parseProviderWrite(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the provider details." };
  const value = parsed.data;
  let baseUrl: string;
  try { baseUrl = assertProviderBaseUrl(value.providerType, value.baseUrl); } catch (error) {
    return { error: error instanceof Error ? error.message : "Base URL is invalid." };
  }
  try {
    const { supabase, user } = await authenticatedClient();
    const headers = value.headers ?? [];
    let ciphertext: string | undefined;
    let hint: string | undefined;
    try {
      if (value.apiKey) {
        ciphertext = encryptSecret({ apiKey: value.apiKey, headers });
        hint = keyHint(value.apiKey);
      } else if (value.id && value.headers) {
        const packed = await supabase.rpc("read_own_provider_secret", { p_config_id: value.id });
        if (packed.error || typeof packed.data !== "string" || !packed.data) return { error: "The saved provider key could not be read." };
        const current = decryptSecret(packed.data);
        ciphertext = encryptSecret({ apiKey: current.apiKey, headers });
      }
    } catch (error) {
      return { error: secretFailure(error) };
    }
    if (value.isDefault) {
      const cleared = await supabase.from("provider_configs").update({ is_default: false }).eq("user_id", user.id);
      if (cleared.error) return { error: providerWriteError(cleared.error) };
    }
    const fields = {
      provider_type: value.providerType,
      name: value.name,
      base_url: baseUrl,
      configuration: {},
      ...(hint ? { key_hint: hint } : {}),
      ...(ciphertext ? { secret_ciphertext: ciphertext } : {}),
      ...(value.isDefault === undefined ? {} : { is_default: value.isDefault }),
    };
    if (value.id) {
      const updated = await supabase.from("provider_configs").update(fields).eq("id", value.id).eq("user_id", user.id).select(providerPublicColumns).maybeSingle();
      if (updated.error) return { error: providerWriteError(updated.error) };
      if (!updated.data) return { error: "That provider is no longer available." };
      return { data: toPublic(updated.data as ProviderRow) };
    }
    if (!ciphertext || !hint) return { error: "Enter an API key." };
    const inserted = await supabase.from("provider_configs").insert({
      ...fields,
      user_id: user.id,
      secret_ciphertext: ciphertext,
      key_hint: hint,
      is_default: value.isDefault === true,
    }).select(providerPublicColumns).single();
    if (inserted.error) return { error: providerWriteError(inserted.error) };
    if (!inserted.data) return { error: saveFailed };
    return { data: toPublic(inserted.data as ProviderRow) };
  } catch {
    return { error: sessionError };
  }
}

export async function deleteProviderConfigAction(id: unknown): Promise<{ error?: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "Choose a provider." };
  try {
    const { supabase, user } = await authenticatedClient();
    const deleted = await supabase.from("provider_configs").delete().eq("id", parsed.data).eq("user_id", user.id).select("id");
    if (deleted.error?.code === "23503") return { error: "That provider is still used by an agent or a conversation." };
    if (deleted.error) return { error: saveFailed };
    if (!deleted.data?.length) return { error: "That provider is no longer available." };
    return {};
  } catch {
    return { error: sessionError };
  }
}

async function directoryCredentials(input: unknown): Promise<{ baseUrl: string; apiKey: string; model?: string } | { error: string }> {
  const parsed = directoryInput.safeParse(input);
  if (!parsed.success) return { error: "Check the provider details." };
  const value = parsed.data;
  const { supabase } = await authenticatedClient();
  if (value.configId) {
    const row = await supabase.from("provider_configs").select("provider_type,base_url").eq("id", value.configId).maybeSingle();
    if (row.error || !row.data) return { error: "Choose one of your providers." };
    const packed = await supabase.rpc("read_own_provider_secret", { p_config_id: value.configId });
    if (packed.error || typeof packed.data !== "string" || !packed.data) return { error: "The saved provider key could not be read." };
    let secret;
    try { secret = decryptSecret(packed.data); } catch (error) { return { error: secretFailure(error) }; }
    try {
      return { baseUrl: assertProviderBaseUrl(row.data.provider_type, row.data.base_url), apiKey: secret.apiKey, model: value.model };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Base URL is invalid." };
    }
  }
  if (!value.providerType || !value.baseUrl || !value.apiKey) return { error: "Enter an API key." };
  try {
    return { baseUrl: assertProviderBaseUrl(value.providerType, value.baseUrl), apiKey: value.apiKey, model: value.model };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Base URL is invalid." };
  }
}

export async function listProviderModelsAction(input: unknown): Promise<{ data?: string[]; error?: string }> {
  try {
    const ready = await directoryCredentials(input);
    if ("error" in ready) return ready;
    const data = await listProviderModels({ baseUrl: ready.baseUrl, apiKey: ready.apiKey, signal: AbortSignal.timeout(15_000) });
    return { data };
  } catch (error) {
    if (error instanceof ProviderRequestError) return { error: error.message };
    return { error: "Models could not be loaded. Enter a model id." };
  }
}

export async function testProviderConnectionAction(input: unknown): Promise<{ data?: { ok: true }; error?: string }> {
  try {
    const ready = await directoryCredentials(input);
    if ("error" in ready) return ready;
    if (!ready.model || !modelId.test(ready.model)) return { error: "Enter a model id." };
    const data = await testProviderConnection({ baseUrl: ready.baseUrl, apiKey: ready.apiKey, model: ready.model, signal: AbortSignal.timeout(15_000) });
    return { data };
  } catch (error) {
    if (error instanceof ProviderRequestError) return { error: error.message };
    return { error: "The provider is unavailable." };
  }
}
