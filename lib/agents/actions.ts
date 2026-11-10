"use server";

import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { agentPublicColumns } from "@/lib/agents/columns";
import { parseAgentWrite, type AgentWrite } from "@/lib/agents/validation";

export type PublicAgent = {
  id: string;
  name: string;
  description: string | null;
  avatar: "spark" | "code" | "search" | "write" | "book";
  systemInstructions: string | null;
  providerBinding: "system" | "explicit" | "default_provider";
  providerConfigId: string | null;
  systemMode: "Fast" | "Balanced" | "High" | null;
  model: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  isEnabled: boolean;
  isDefault: boolean;
};

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  avatar: PublicAgent["avatar"];
  system_instructions: string | null;
  provider_binding: PublicAgent["providerBinding"];
  provider_config_id: string | null;
  system_mode: PublicAgent["systemMode"];
  model: string | null;
  temperature: number | string | null;
  max_output_tokens: number | null;
  is_enabled: boolean;
  is_default: boolean;
};

type DbError = { code?: string; message?: string } | null;

const sessionError = "Your session has expired or the service is unavailable. Please try again.";
const saveFailed = "We couldn't save that change. Please try again.";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) throw new Error(sessionError);
  return { supabase, user };
}

function asNumber(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPublic(row: AgentRow): PublicAgent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatar: row.avatar,
    systemInstructions: row.system_instructions,
    providerBinding: row.provider_binding,
    providerConfigId: row.provider_config_id,
    systemMode: row.system_mode,
    model: row.model,
    temperature: asNumber(row.temperature),
    maxOutputTokens: row.max_output_tokens,
    isEnabled: row.is_enabled,
    isDefault: row.is_default,
  };
}

function agentWriteError(error: DbError) {
  const message = error?.message ?? "";
  if (message.includes("agent cap")) return "You can save up to 20 agents.";
  if (error?.code === "23505") return "Could not update the default agent. Try again.";
  if (error?.code === "23503") return "Choose one of your providers.";
  return saveFailed;
}

function storedShape(value: AgentWrite) {
  const system = value.providerBinding === "system";
  return {
    name: value.name,
    description: value.description ?? null,
    avatar: value.avatar,
    system_instructions: value.systemInstructions ?? null,
    provider_binding: value.providerBinding,
    provider_config_id: value.providerBinding === "explicit" ? value.providerConfigId ?? null : null,
    system_mode: system ? value.systemMode ?? null : null,
    model: system ? null : value.model ?? null,
    temperature: system ? null : value.temperature ?? null,
    max_output_tokens: system ? null : value.maxOutputTokens ?? null,
    ...(value.isEnabled === undefined ? {} : { is_enabled: value.isEnabled }),
    ...(value.isDefault === undefined ? {} : { is_default: value.isDefault }),
  };
}

async function clearDefault(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) {
  return supabase.from("agents").update({ is_default: false }).eq("user_id", userId).eq("is_default", true);
}

export async function listAgentsAction(): Promise<{ data?: PublicAgent[]; error?: string }> {
  try {
    const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("agents").select(agentPublicColumns).order("updated_at", { ascending: false });
    if (error) return { error: saveFailed };
    return { data: ((data ?? []) as AgentRow[]).map(toPublic) };
  } catch {
    return { error: sessionError };
  }
}

export async function saveAgentAction(input: unknown): Promise<{ data?: PublicAgent; error?: string }> {
  const parsed = parseAgentWrite(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the agent details." };
  const value = parsed.data;
  if (value.isDefault && value.isEnabled === false) return { error: "Enable an agent before making it the default." };
  try {
    const { supabase, user } = await authenticatedClient();
    if (value.providerBinding === "explicit") {
      const owned = await supabase.from("provider_configs").select("id").eq("id", value.providerConfigId).eq("user_id", user.id).maybeSingle();
      if (owned.error || !owned.data) return { error: "Choose one of your providers." };
    }
    if (value.isDefault) {
      const cleared = await clearDefault(supabase, user.id);
      if (cleared.error) return { error: agentWriteError(cleared.error) };
    }
    const fields = storedShape(value);
    if (value.id) {
      const updated = await supabase.from("agents").update(fields).eq("id", value.id).eq("user_id", user.id).select(agentPublicColumns).maybeSingle();
      if (updated.error) return { error: agentWriteError(updated.error) };
      if (!updated.data) return { error: "That agent is not available." };
      return { data: toPublic(updated.data as AgentRow) };
    }
    const inserted = await supabase.from("agents").insert({
      ...fields,
      user_id: user.id,
      is_enabled: value.isEnabled !== false,
      is_default: value.isDefault === true,
    }).select(agentPublicColumns).single();
    if (inserted.error) return { error: agentWriteError(inserted.error) };
    if (!inserted.data) return { error: saveFailed };
    return { data: toPublic(inserted.data as AgentRow) };
  } catch {
    return { error: sessionError };
  }
}

export async function duplicateAgentAction(id: unknown): Promise<{ data?: PublicAgent; error?: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "Choose a valid agent." };
  try {
    const { supabase, user } = await authenticatedClient();
    const source = await supabase.from("agents").select(agentPublicColumns).eq("id", parsed.data).eq("user_id", user.id).maybeSingle();
    if (source.error || !source.data) return { error: "That agent is not available." };
    const row = source.data as AgentRow;
    const name = `${row.name} copy`.trim().slice(0, 80).trim();
    const inserted = await supabase.from("agents").insert({
      user_id: user.id,
      name,
      description: row.description,
      avatar: row.avatar,
      system_instructions: row.system_instructions,
      provider_binding: row.provider_binding,
      provider_config_id: row.provider_config_id,
      system_mode: row.system_mode,
      model: row.model,
      temperature: asNumber(row.temperature),
      max_output_tokens: row.max_output_tokens,
      is_enabled: row.is_enabled,
      is_default: false,
    }).select(agentPublicColumns).single();
    if (inserted.error) return { error: agentWriteError(inserted.error) };
    if (!inserted.data) return { error: saveFailed };
    return { data: toPublic(inserted.data as AgentRow) };
  } catch {
    return { error: sessionError };
  }
}

export async function deleteAgentAction(id: unknown): Promise<{ error?: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "Choose a valid agent." };
  try {
    const { supabase, user } = await authenticatedClient();
    const deleted = await supabase.from("agents").delete().eq("id", parsed.data).eq("user_id", user.id).select("id");
    if (deleted.error) return { error: saveFailed };
    if (!deleted.data?.length) return { error: "That agent is not available." };
    return {};
  } catch {
    return { error: sessionError };
  }
}

export async function setDefaultAgentAction(id: unknown): Promise<{ error?: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "Choose a valid agent." };
  try {
    const { supabase, user } = await authenticatedClient();
    const current = await supabase.from("agents").select("id,is_enabled").eq("id", parsed.data).eq("user_id", user.id).maybeSingle();
    if (current.error || !current.data?.is_enabled) return { error: "That agent is not available." };
    const cleared = await clearDefault(supabase, user.id);
    if (cleared.error) return { error: agentWriteError(cleared.error) };
    const updated = await supabase.from("agents").update({ is_default: true }).eq("id", parsed.data).eq("user_id", user.id).eq("is_enabled", true).select("id");
    if (updated.error) return { error: agentWriteError(updated.error) };
    if (!updated.data?.length) return { error: "That agent is not available." };
    return {};
  } catch {
    return { error: sessionError };
  }
}

export async function setAgentEnabledAction(id: unknown, enabled: unknown): Promise<{ error?: string }> {
  const parsed = z.string().uuid().safeParse(id);
  const flag = z.boolean().safeParse(enabled);
  if (!parsed.success || !flag.success) return { error: "Choose a valid agent." };
  try {
    const { supabase, user } = await authenticatedClient();
    const updated = await supabase.from("agents").update({
      is_enabled: flag.data,
      ...(flag.data ? {} : { is_default: false }),
    }).eq("id", parsed.data).eq("user_id", user.id).select("id");
    if (updated.error) return { error: saveFailed };
    if (!updated.data?.length) return { error: "That agent is not available." };
    return {};
  } catch {
    return { error: sessionError };
  }
}
