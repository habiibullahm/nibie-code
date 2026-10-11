"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { deleteMemoryAction, forgetMemoryAction, listMemoriesAction, listMemoriesPageAction, updateMemoryAction } from "@/app/actions/memories";
import { SettingsSection, SettingsToggle } from "@/components/settings/settings-section";
import type { SettingsSectionProps } from "@/components/settings/sections";
import { memoryContentLimit, memoryTypes, type MemoryRecord, type MemoryType } from "@/lib/recall/types";

const typeLabels: Record<MemoryType, string> = {
  preference: "Preferences",
  project: "Projects",
  instruction: "Instructions",
  fact: "Facts",
};

function MemoryRow({ memory, disabled, preview, onChanged }: {
  memory: MemoryRecord;
  disabled: boolean;
  preview: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(memory.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function mutate(kind: "save" | "forget" | "delete") {
    if (busy || disabled || preview) return;
    setBusy(true);
    setError(null);
    startTransition(async () => {
      try {
        const result = kind === "save"
          ? await updateMemoryAction(memory.id, { type: memory.type, content: draft })
          : kind === "forget" ? await forgetMemoryAction(memory.id) : await deleteMemoryAction(memory.id);
        if (result.error) { setError(result.error); return; }
        onChanged();
      } catch {
        setError("This memory couldn't be updated. Try again.");
      } finally {
        setBusy(false);
      }
    });
  }

  return <div className="memory-row" data-inactive={memory.isActive ? undefined : "true"}>
    <textarea
      className="memory-row-text"
      maxLength={memoryContentLimit}
      disabled={disabled || busy || !memory.isActive}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      aria-label={`Memory (${memory.type})`}
    />
    <div className="memory-row-actions">
      {memory.isActive ? <button type="button" disabled={disabled || busy || draft.trim() === memory.content} onClick={() => mutate("save")}>Save memory</button> : null}
      {!memory.isActive ? <span className="settings-note">Forgotten</span> : null}
      {memory.isActive ? <button type="button" disabled={disabled || busy} onClick={() => mutate("forget")}>Forget</button> : null}
      <button type="button" disabled={disabled || busy} onClick={() => mutate("delete")}>Delete</button>
    </div>
    {error ? <p className="settings-note" role="alert">{error}</p> : null}
  </div>;
}

export function MemorySettingsSection({ preferences, disabled: unavailable, saving, preview = false, onChange }: SettingsSectionProps) {
  const disabled = unavailable || saving;
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const enabled = preferences.recallEnabled;

  const applyPage = useCallback((page: Awaited<ReturnType<typeof fetchFirstPage>>) => {
    setMemories(page.memories);
    setHasMore(page.hasMore);
    setNextOffset(page.nextOffset);
    setLoadError(null);
  }, []);

  function reload() {
    if (preview) return;
    setLoading(true);
    startTransition(async () => {
      try { applyPage(await fetchFirstPage()); }
      catch { setLoadError("Memories couldn't be loaded. Try again."); }
      finally { setLoading(false); }
    });
  }

  function loadMore() {
    if (preview || loadingMore || !hasMore) return;
    setLoadingMore(true);
    startTransition(async () => {
      try {
        const page = await listMemoriesPageAction({ offset: nextOffset, activeOnly: "all" });
        if (page.error || !page.data) { setLoadError(page.error ?? "Memories couldn't be loaded. Try again."); return; }
        const data = page.data;
        setMemories((current) => {
          const seen = new Set(current.map((memory) => memory.id));
          return [...current, ...data.memories.filter((memory) => !seen.has(memory.id))];
        });
        setLoadError(null);
        setHasMore(data.hasMore);
        setNextOffset(data.nextOffset);
      } catch { setLoadError("Memories couldn't be loaded. Try again."); }
      finally { setLoadingMore(false); }
    });
  }

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    startTransition(async () => {
      try {
        const page = await fetchFirstPage();
        if (!cancelled) applyPage(page);
      } catch {
        if (!cancelled) setLoadError("Memories couldn't be loaded. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [preview, applyPage]);

  const grouped = memoryTypes.map((type) => ({
    type,
    items: memories.filter((memory) => memory.type === type),
  })).filter((group) => group.items.length > 0);

  return <SettingsSection title="Memory & Context" description="Facts you asked Nibie to remember across conversations. Transparent and under your control — not hidden profiling.">
    <SettingsToggle label="Use saved memories" hint={enabled
      ? "Nibie may save when you ask and use active memories when they are relevant."
      : "Recall is off. Nothing new is saved or retrieved. Stored memories stay until you delete them."}
      checked={enabled} disabled={disabled} onChange={(recallEnabled) => onChange({ recallEnabled })} />
    <p className="settings-note">Saved memories can carry across chats. Conversation history belongs to each chat; a Room supplies its own instructions and files. Turning memory off does not delete any of these.</p>
    <p className="settings-note">Edit a memory and choose Save memory. Forget stops using it; Delete permanently removes it.</p>
    {loading ? <p className="settings-note">Loading memories…</p> : null}
    {loadError ? <p className="settings-note" role="alert">{loadError} <button className="settings-save" type="button" disabled={loading} onClick={reload}>Try again</button></p> : null}
    {!loading && !loadError && !grouped.length ? <p className="settings-note">No saved memories yet. In chat, say “remember …” or “ingat …” to store one.</p> : null}
    {grouped.map((group) => <div key={group.type} className="memory-group">
      <div className="settings-theme-label">{typeLabels[group.type]}</div>
      {group.items.map((memory) => <MemoryRow key={memory.id} memory={memory} disabled={disabled || loading || loadingMore} preview={preview} onChanged={reload} />)}
    </div>)}
    {hasMore ? <div className="memory-row-actions">
      <button type="button" disabled={disabled || loadingMore} onClick={loadMore}>
        {loadingMore ? "Loading…" : "Load more memories"}
      </button>
    </div> : null}
  </SettingsSection>;
}


async function fetchFirstPage() {
  const page = await listMemoriesPageAction({ offset: 0, activeOnly: "all" });
  if (!page.error && page.data) return page.data;
  const result = await listMemoriesAction();
  if (result.error) throw new Error(result.error);
  return { memories: result.data ?? [], hasMore: false, nextOffset: result.data?.length ?? 0 };
}
