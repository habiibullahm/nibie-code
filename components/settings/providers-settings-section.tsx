"use client";

import { useEffect, useState } from "react";
import { listProviderConfigsAction, listProviderModelsAction, saveProviderConfigAction, deleteProviderConfigAction, testProviderConnectionAction, type PublicProviderConfig } from "@/lib/providers/actions";
import { SettingsChoice, SettingsSection } from "@/components/settings/settings-section";
import type { SettingsSectionProps } from "@/components/settings/sections";

const nibieRouterUrl = "https://router.nibie.app/v1";
const typeLabel = { nibie_router: "Nibie Router", openai_compatible: "Custom" } as const;

type HeaderDraft = { name: string; value: string };

export function ProvidersSettingsSection({ disabled, saving, preview = false }: SettingsSectionProps) {
  const [configs, setConfigs] = useState<PublicProviderConfig[]>([]);
  const [loading, setLoading] = useState(!preview);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [providerType, setProviderType] = useState<"nibie_router" | "openai_compatible">("nibie_router");
  const [name, setName] = useState("Nibie Router");
  const [baseUrl, setBaseUrl] = useState(nibieRouterUrl);
  const [apiKey, setApiKey] = useState("");
  const [headers, setHeaders] = useState<HeaderDraft[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = disabled || saving || busy;
  const url = providerType === "nibie_router" ? nibieRouterUrl : baseUrl;

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    listProviderConfigsAction().then((result) => {
      if (cancelled) return;
      if (result.error) setLoadError(result.error);
      else setConfigs(result.data ?? []);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setLoadError("Providers couldn't be loaded."); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [preview]);

  function selectConfig(config: PublicProviderConfig) {
    setEditingId(config.id);
    setProviderType(config.providerType);
    setName(config.name);
    setBaseUrl(config.baseUrl);
    setApiKey("");
    setHeaders([]);
    setModels([]);
    setStatus(null);
  }

  function resetForm() {
    setEditingId(null);
    setProviderType("nibie_router");
    setName("Nibie Router");
    setBaseUrl(nibieRouterUrl);
    setApiKey("");
    setHeaders([]);
    setModels([]);
    setModelId("");
    setStatus(null);
  }

  async function refresh() {
    const result = await listProviderConfigsAction();
    if (result.data) setConfigs(result.data);
    return result;
  }

  async function save() {
    if (locked || preview) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveProviderConfigAction({
        ...(editingId ? { id: editingId } : {}),
        providerType,
        name,
        baseUrl: url,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        headers: headers.filter((header) => header.name.trim() && header.value.trim()),
      });
      if (result.error) { setStatus(result.error); return; }
      setApiKey("");
      if (result.data) setEditingId(result.data.id);
      await refresh();
      setStatus("Saved");
    } catch {
      setStatus("We couldn't save that change. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault() {
    if (!editingId || locked || preview) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveProviderConfigAction({ id: editingId, providerType, name, baseUrl: url, isDefault: true });
      if (result.error) { setStatus(result.error); return; }
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
      const result = await deleteProviderConfigAction(editingId);
      if (result.error) { setStatus(result.error); return; }
      resetForm();
      await refresh();
      setStatus("Saved");
    } catch {
      setStatus("We couldn't save that change. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function credentialInput() {
    return editingId && !apiKey.trim()
      ? { configId: editingId }
      : { providerType, baseUrl: url, apiKey: apiKey.trim() };
  }

  async function fetchModels() {
    if (locked || preview) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await listProviderModelsAction(credentialInput());
      if (result.error) { setStatus(result.error); return; }
      setModels(result.data ?? []);
      setStatus(result.data?.length ? "Models loaded." : "No models were returned. Enter a model id.");
    } catch {
      setStatus("Models could not be loaded. Enter a model id.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (locked || preview || !modelId.trim()) { setStatus("Enter a model id."); return; }
    setBusy(true);
    setStatus(null);
    try {
      const result = await testProviderConnectionAction({ ...credentialInput(), model: modelId.trim() });
      setStatus(result.error ?? "Connection succeeded.");
    } catch {
      setStatus("The provider is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return <SettingsSection title="Providers" description="Save a key for Nibie Router or another HTTPS provider. The key stays on the server.">
    {loading ? <p className="settings-note">Loading providers…</p> : null}
    {loadError ? <p className="settings-note" role="alert">{loadError}</p> : null}
    {!loading && !loadError && configs.length === 0 ? <p className="settings-note">No providers yet.</p> : null}
    {configs.map((config) => <button key={config.id} type="button" className="memory-row" onClick={() => selectConfig(config)} aria-pressed={editingId === config.id}>
      <strong>{config.name}</strong>
      <span className="settings-note">{typeLabel[config.providerType]} · {config.baseUrl}</span>
      <span className="settings-note">Key ending {config.keyHint}{config.isDefault ? " · Default" : ""}</span>
    </button>)}
    <SettingsChoice label="Provider" value={providerType} options={[{ value: "nibie_router", label: "Nibie Router" }, { value: "openai_compatible", label: "Custom" }]} disabled={locked} onChange={(value) => { setProviderType(value); if (value === "nibie_router") setBaseUrl(nibieRouterUrl); }} />
    <div className="settings-field">
      <label htmlFor="provider-name">Name</label>
      <input id="provider-name" maxLength={80} disabled={locked} value={name} onChange={(event) => setName(event.target.value)} />
    </div>
    <div className="settings-field">
      <label htmlFor="provider-base-url">Base URL</label>
      <input id="provider-base-url" maxLength={300} disabled={locked || providerType === "nibie_router"} readOnly={providerType === "nibie_router"} value={url} onChange={(event) => setBaseUrl(event.target.value)} />
    </div>
    <div className="settings-field">
      <label htmlFor="provider-api-key">API key</label>
      <input id="provider-api-key" type="password" autoComplete="off" maxLength={400} disabled={locked} value={apiKey} placeholder={editingId ? "Leave blank to keep the saved key" : undefined} onChange={(event) => setApiKey(event.target.value)} />
    </div>
    {headers.map((header, index) => <div key={index} className="settings-field">
      <label htmlFor={`provider-header-name-${index}`}>Header {index + 1}</label>
      <input id={`provider-header-name-${index}`} maxLength={40} disabled={locked} placeholder="Name" value={header.name} onChange={(event) => setHeaders((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} />
      <input aria-label={`Header ${index + 1} value`} type="password" autoComplete="off" maxLength={200} disabled={locked} placeholder="Value" value={header.value} onChange={(event) => setHeaders((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row))} />
    </div>)}
    <div className="memory-row-actions">
      <button type="button" className="settings-save" disabled={locked || headers.length >= 5} onClick={() => setHeaders((rows) => [...rows, { name: "", value: "" }])}>Add header</button>
      <button type="button" className="settings-save" disabled={locked || preview} onClick={() => void fetchModels()}>Fetch models</button>
      <button type="button" className="settings-save" disabled={locked || preview} onClick={() => void testConnection()}>Test connection</button>
      <button type="button" className="settings-save" disabled={locked || preview} onClick={() => void save()}>Save</button>
      <button type="button" className="settings-save" disabled={locked || preview || !editingId} onClick={() => void remove()}>Delete</button>
      <button type="button" className="settings-save" disabled={locked || preview || !editingId} onClick={() => void makeDefault()}>Make default</button>
    </div>
    {models.length ? <div className="settings-field">
      <label htmlFor="provider-model-list">Models</label>
      <select id="provider-model-list" disabled={locked} value={models.includes(modelId) ? modelId : ""} onChange={(event) => setModelId(event.target.value)}>
        <option value="">Choose a model</option>
        {models.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
    </div> : null}
    <div className="settings-field">
      <label htmlFor="provider-model-id">Model id</label>
      <input id="provider-model-id" maxLength={128} disabled={locked} value={modelId} onChange={(event) => setModelId(event.target.value)} />
    </div>
    {status ? <p className="settings-status" role="status">{status}</p> : null}
  </SettingsSection>;
}
