"use client";

import { useEffect, useState } from "react";
import { deleteAgentAction, duplicateAgentAction, listAgentsAction, saveAgentAction, setAgentEnabledAction, setDefaultAgentAction, type PublicAgent } from "@/lib/agents/actions";
import { listProviderConfigsAction, type PublicProviderConfig } from "@/lib/providers/actions";
import { SettingsChoice, SettingsSection, SettingsTextField, SettingsToggle } from "@/components/settings/settings-section";
import type { SettingsSectionProps } from "@/components/settings/sections";

const avatars = [
  { value: "spark", label: "Spark" },
  { value: "code", label: "Code" },
  { value: "search", label: "Search" },
  { value: "write", label: "Write" },
  { value: "book", label: "Book" },
] as const;

const bindings = [
  { value: "system", label: "System mode" },
  { value: "default_provider", label: "Default provider" },
  { value: "explicit", label: "Selected provider" },
] as const;

const modes = [
  { value: "Fast", label: "Fast" },
  { value: "Balanced", label: "Balanced" },
  { value: "High", label: "High" },
] as const;

const bindingLabel = { system: "System mode", default_provider: "Default provider", explicit: "Selected provider" } as const;

type Binding = PublicAgent["providerBinding"];
type Avatar = PublicAgent["avatar"];

const empty = {
  name: "",
  description: "",
  avatar: "spark" as Avatar,
  instructions: "",
  binding: "system" as Binding,
  providerConfigId: "",
  systemMode: "Balanced" as "Fast" | "Balanced" | "High",
  model: "",
  temperature: "",
  maxOutputTokens: "",
  isEnabled: true,
  isDefault: false,
};

export function AgentsSettingsSection({ disabled, saving, preview = false }: SettingsSectionProps) {
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [providers, setProviders] = useState<PublicProviderConfig[]>([]);
  const [loading, setLoading] = useState(!preview);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [savedInstructions, setSavedInstructions] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = disabled || saving || busy;
  const open = creating || editingId !== null;

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    Promise.all([listAgentsAction(), listProviderConfigsAction()]).then(([agentResult, providerResult]) => {
      if (cancelled) return;
      if (agentResult.error) setLoadError(agentResult.error);
      else setAgents(agentResult.data ?? []);
      if (providerResult.data) setProviders(providerResult.data);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setLoadError("Agents couldn't be loaded."); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [preview]);

  function load(agent: PublicAgent) {
    setEditingId(agent.id);
    setCreating(false);
    setConfirmDelete(false);
    setSavedInstructions(agent.systemInstructions ?? "");
    setForm({
      name: agent.name,
      description: agent.description ?? "",
      avatar: agent.avatar,
      instructions: agent.systemInstructions ?? "",
      binding: agent.providerBinding,
      providerConfigId: agent.providerConfigId ?? "",
      systemMode: agent.systemMode ?? "Balanced",
      model: agent.model ?? "",
      temperature: agent.temperature == null ? "" : String(agent.temperature),
      maxOutputTokens: agent.maxOutputTokens == null ? "" : String(agent.maxOutputTokens),
      isEnabled: agent.isEnabled,
      isDefault: agent.isDefault,
    });
    setStatus(null);
  }

  function startNew() {
    setEditingId(null);
    setCreating(true);
    setConfirmDelete(false);
    setSavedInstructions("");
    setForm(empty);
    setStatus(null);
  }

  function payload(instructions = form.instructions) {
    const temperature = form.temperature.trim() === "" ? null : Number(form.temperature);
    const maxOutputTokens = form.maxOutputTokens.trim() === "" ? null : Number(form.maxOutputTokens);
    return {
      ...(editingId ? { id: editingId } : {}),
      name: form.name,
      description: form.description.trim() ? form.description.trim() : null,
      avatar: form.avatar,
      systemInstructions: instructions.trim() ? instructions.trim() : null,
      providerBinding: form.binding,
      providerConfigId: form.binding === "explicit" ? form.providerConfigId || null : null,
      systemMode: form.binding === "system" ? form.systemMode : null,
      model: form.binding === "system" ? null : form.model.trim() || null,
      temperature: form.binding === "system" ? null : temperature,
      maxOutputTokens: form.binding === "system" ? null : maxOutputTokens,
      isEnabled: form.isEnabled,
      isDefault: form.isDefault,
    };
  }

  async function refresh() {
    const result = await listAgentsAction();
    if (result.data) setAgents(result.data);
    return result;
  }

  async function save(instructions = form.instructions) {
    if (locked || preview) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveAgentAction(payload(instructions));
      if (result.error) { setStatus(result.error); return; }
      if (result.data) {
        setEditingId(result.data.id);
        setCreating(false);
        setSavedInstructions(result.data.systemInstructions ?? "");
      }
      await refresh();
      setStatus("Saved");
    } catch {
      setStatus("We couldn't save that change. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (!editingId || locked || preview) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await duplicateAgentAction(editingId);
      if (result.error || !result.data) { setStatus(result.error ?? "We couldn't save that change. Please try again."); return; }
      load(result.data);
      await refresh();
      setStatus("Saved");
    } catch {
      setStatus("We couldn't save that change. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editingId || locked || preview) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await deleteAgentAction(editingId);
      if (result.error) { setStatus(result.error); return; }
      setEditingId(null);
      setCreating(false);
      setConfirmDelete(false);
      setForm(empty);
      await refresh();
      setStatus("Saved");
    } catch {
      setStatus("We couldn't save that change. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(enabled: boolean) {
    setForm((current) => ({ ...current, isEnabled: enabled, isDefault: enabled ? current.isDefault : false }));
    if (!editingId || preview) return;
    setBusy(true);
    const result = await setAgentEnabledAction(editingId, enabled);
    setBusy(false);
    if (result.error) { setStatus(result.error); return; }
    await refresh();
  }

  async function setDefault(isDefault: boolean) {
    setForm((current) => ({ ...current, isDefault, isEnabled: isDefault ? true : current.isEnabled }));
    if (!editingId || preview) return;
    setBusy(true);
    const result = isDefault ? await setDefaultAgentAction(editingId) : await saveAgentAction({ ...payload(), isDefault: false });
    setBusy(false);
    if (result.error) { setStatus(result.error); return; }
    await refresh();
  }

  return <SettingsSection title="Agents" description="Edits apply to new chats. Chats you already started keep the agent they were given.">
    {loading ? <p className="settings-note">Loading agents…</p> : null}
    {loadError ? <p className="settings-note" role="alert">{loadError}</p> : null}
    {!loading && agents.length === 0 ? <p className="settings-note">No agents yet.</p> : null}
    {agents.map((agent) => <button key={agent.id} type="button" className="memory-row" onClick={() => load(agent)} aria-pressed={editingId === agent.id}>
      <strong>{agent.name}</strong>
      <span className="settings-note">{agent.isEnabled ? "Enabled" : "Disabled"}{agent.isDefault ? " · Default" : ""} · {bindingLabel[agent.providerBinding]}</span>
    </button>)}
    <button type="button" className="settings-save" disabled={locked} onClick={startNew}>New agent</button>
    {open ? <>
      <div className="settings-field">
        <label htmlFor="agent-name">Name</label>
        <input id="agent-name" maxLength={80} disabled={locked} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
      </div>
      <div className="settings-field">
        <label htmlFor="agent-description">Description</label>
        <input id="agent-description" maxLength={500} disabled={locked} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
      </div>
      <SettingsChoice label="Avatar" value={form.avatar} options={[...avatars]} disabled={locked} onChange={(avatar) => setForm((current) => ({ ...current, avatar }))} />
      <SettingsTextField id="agent-instructions" label="System instructions" hint="Edits apply to new chats. Chats you already started keep the agent they were given." value={savedInstructions} maxLength={8000} multiline disabled={locked} draft={form.instructions} onDraftChange={(instructions) => setForm((current) => ({ ...current, instructions }))} onCommit={(instructions) => { setForm((current) => ({ ...current, instructions })); void save(instructions); }} />
      <SettingsChoice label="Provider" value={form.binding} options={[...bindings]} disabled={locked} onChange={(binding) => setForm((current) => ({ ...current, binding }))} />
      {form.binding === "system" ? <SettingsChoice label="Mode" value={form.systemMode} options={[...modes]} disabled={locked} onChange={(systemMode) => setForm((current) => ({ ...current, systemMode }))} /> : null}
      {form.binding === "explicit" ? <div className="settings-field">
        <label htmlFor="agent-provider">Selected provider</label>
        <select id="agent-provider" disabled={locked} value={form.providerConfigId} onChange={(event) => setForm((current) => ({ ...current, providerConfigId: event.target.value }))}>
          <option value="">Choose a provider</option>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select>
      </div> : null}
      {form.binding !== "system" ? <>
        <div className="settings-field">
          <label htmlFor="agent-model">Model id</label>
          <input id="agent-model" maxLength={128} disabled={locked} value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} />
        </div>
        <div className="settings-field">
          <label htmlFor="agent-temperature">Temperature</label>
          <input id="agent-temperature" inputMode="decimal" disabled={locked} value={form.temperature} onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))} />
        </div>
        <div className="settings-field">
          <label htmlFor="agent-max-tokens">Max tokens</label>
          <input id="agent-max-tokens" inputMode="numeric" disabled={locked} value={form.maxOutputTokens} onChange={(event) => setForm((current) => ({ ...current, maxOutputTokens: event.target.value }))} />
        </div>
      </> : null}
      <SettingsToggle label="Enabled" hint="Disabled agents stay out of the new-chat menu." checked={form.isEnabled} disabled={locked} onChange={(isEnabled) => void setEnabled(isEnabled)} />
      <SettingsToggle label="Default" hint="New chats start with this agent selected." checked={form.isDefault} disabled={locked} onChange={(isDefault) => void setDefault(isDefault)} />
      <div className="memory-row-actions">
        <button type="button" className="settings-save" disabled={locked || preview} onClick={() => void save()}>Save</button>
        <button type="button" className="settings-save" disabled={locked || preview || !editingId} onClick={() => void duplicate()}>Duplicate</button>
        <button type="button" className="settings-save" disabled={locked || preview || !editingId} onClick={() => setConfirmDelete(true)}>Delete</button>
        {confirmDelete ? <button type="button" className="settings-save" disabled={locked || preview} onClick={() => void remove()}>Delete agent</button> : null}
      </div>
      {status ? <p className="settings-status" role="status">{status}</p> : null}
    </> : null}
  </SettingsSection>;
}
