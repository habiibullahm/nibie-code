"use client";

import { useState, useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import { RoomFiles } from "@/components/room-files";
import type { ConversationSummary, PinSummary, RoomSummary } from "@/lib/chat/read";
import type { PinDraft } from "@/lib/pins/types";
import { roomBriefFields, type RoomBriefFields } from "@/lib/rooms/types";

type SaveResult = { error?: string };
const noopSubscribe = () => () => undefined;

type Props = {
  room: RoomSummary;
  threads: ConversationSummary[];
  busy: boolean;
  onOpenThread: (id: string) => void;
  onNewThread: () => void;
  onSaveRoom: (patch: { name: string; description: string | null; instructions: string | null }) => Promise<SaveResult>;
  onSaveBrief: (brief: RoomBriefFields) => Promise<SaveResult>;
  onCreatePin: (draft: PinDraft) => Promise<SaveResult>;
  onUpdatePin: (id: string, draft: PinDraft) => Promise<SaveResult>;
  onDeletePin: (id: string) => Promise<SaveResult>;
  onDelete: () => Promise<SaveResult>;
  preview?: boolean;
};

function pinPreview(content: string) {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}


function briefFromRoom(room: RoomSummary): RoomBriefFields {
  return {
    goal: room.brief?.goal ?? null,
    currentFocus: room.brief?.current_focus ?? null,
    importantDecisions: room.brief?.important_decisions ?? null,
    openQuestions: room.brief?.open_questions ?? null,
    next: room.brief?.next_step ?? null,
  };
}

export function RoomDetail({ room, threads, busy, onOpenThread, onNewThread, onSaveRoom, onSaveBrief, onCreatePin, onUpdatePin, onDeletePin, onDelete, preview = false }: Props) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  const [instructions, setInstructions] = useState(room.instructions ?? "");
  const [brief, setBrief] = useState(() => briefFromRoom(room));
  const [savedStamp, setSavedStamp] = useState(`${room.updated_at}:${JSON.stringify(room.brief)}`);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"room" | "brief" | "delete" | "pin" | null>(null);
  const [addingPin, setAddingPin] = useState(false);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [pinTitle, setPinTitle] = useState("");
  const [pinContent, setPinContent] = useState("");
  const stamp = `${room.updated_at}:${JSON.stringify(room.brief)}`;
  if (stamp !== savedStamp) {
    setSavedStamp(stamp);
    setName(room.name);
    setDescription(room.description ?? "");
    setInstructions(room.instructions ?? "");
    setBrief(briefFromRoom(room));
  }

  async function saveRoom() {
    setSaving("room");
    setError("");
    const result = await onSaveRoom({ name, description: description.trim() || null, instructions: instructions.trim() || null });
    setSaving(null);
    if (result.error) setError(result.error);
  }

  async function saveBrief() {
    setSaving("brief");
    setError("");
    const result = await onSaveBrief({
      goal: brief.goal?.trim() || null,
      currentFocus: brief.currentFocus?.trim() || null,
      importantDecisions: brief.importantDecisions?.trim() || null,
      openQuestions: brief.openQuestions?.trim() || null,
      next: brief.next?.trim() || null,
    });
    setSaving(null);
    if (result.error) setError(result.error);
  }

  function closePinForm() {
    setAddingPin(false);
    setEditingPinId(null);
    setPinTitle("");
    setPinContent("");
  }

  function startAddPin() {
    setAddingPin(true);
    setEditingPinId(null);
    setPinTitle("");
    setPinContent("");
    setError("");
  }

  function startEditPin(pin: PinSummary) {
    setAddingPin(false);
    setEditingPinId(pin.id);
    setPinTitle(pin.title);
    setPinContent(pin.content);
    setError("");
  }

  async function savePin() {
    const draft = { title: pinTitle.trim(), content: pinContent.trim() };
    setSaving("pin");
    setError("");
    const result = editingPinId ? await onUpdatePin(editingPinId, draft) : await onCreatePin(draft);
    setSaving(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    closePinForm();
  }

  async function removePin(pin: PinSummary) {
    if (!window.confirm(`Delete “${pin.title}”?`)) return;
    setSaving("pin");
    setError("");
    const result = await onDeletePin(pin.id);
    setSaving(null);
    if (result.error) setError(result.error);
    else if (editingPinId === pin.id) closePinForm();
  }

  async function remove() {
    if (!window.confirm(`Delete “${room.name}”? Threads in this room become general threads. Pins in this room are deleted.`)) return;
    setSaving("delete");
    setError("");
    const result = await onDelete();
    setSaving(null);
    if (result.error) setError(result.error);
  }

  const locked = !mounted || busy || saving !== null;

  return <div className="room-detail">
    <p className="welcome-eyebrow">Room</p>
    <div className="room-fields">
      <label className="room-field"><span>Name</span><input value={name} maxLength={80} disabled={locked} onChange={(event) => setName(event.target.value)} /></label>
      <label className="room-field"><span>Description</span><textarea value={description} maxLength={500} rows={3} disabled={locked} onChange={(event) => setDescription(event.target.value)} placeholder="What this room is for" /></label>
      <label className="room-field"><span>Instructions</span><textarea value={instructions} maxLength={2000} rows={5} disabled={locked} onChange={(event) => setInstructions(event.target.value)} placeholder="How Nibie should work in this room" /></label>
      <button type="button" className="privacy-button" disabled={locked || !name.trim()} onClick={() => void saveRoom()}>{saving === "room" ? "Saving…" : "Save room"}</button>
    </div>
    <section className="room-brief" aria-label="Room brief">
      <h2>Brief</h2>
      <p>A short, editable picture of this room. Nibie uses it as context in threads here.</p>
      {roomBriefFields.map((field) => <label className="room-field" key={field.key}><span>{field.label}</span><textarea value={brief[field.key] ?? ""} maxLength={500} rows={3} disabled={locked} onChange={(event) => setBrief((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
      <button type="button" className="privacy-button" disabled={locked} onClick={() => void saveBrief()}>{saving === "brief" ? "Saving…" : "Save brief"}</button>
    </section>
    <RoomFiles roomId={room.id} disabled={locked} preview={preview} />
    <section className="room-pins" aria-label="Pins">
      <div className="room-threads-head"><h2>Pins</h2><button type="button" className="privacy-button" disabled={locked || addingPin} onClick={startAddPin}><Plus size={15} aria-hidden="true" /> Add pin</button></div>
      <p>A few facts you want Nibie to keep in this room.</p>
      {addingPin || editingPinId ? <div className="room-pin-form">
        <label className="room-field"><span>Title</span><input value={pinTitle} maxLength={80} disabled={locked} onChange={(event) => setPinTitle(event.target.value)} /></label>
        <label className="room-field"><span>Content</span><textarea value={pinContent} maxLength={1000} rows={4} disabled={locked} onChange={(event) => setPinContent(event.target.value)} /></label>
        <div className="room-pin-form-actions">
          <button type="button" className="privacy-button" disabled={locked || !pinTitle.trim() || !pinContent.trim()} onClick={() => void savePin()}>{saving === "pin" ? "Saving…" : "Save pin"}</button>
          <button type="button" className="privacy-button" disabled={locked} onClick={closePinForm}>Cancel</button>
        </div>
      </div> : null}
      {room.pins.length ? <ul className="room-pin-list">{room.pins.map((pin) => <li className="room-pin" key={pin.id}>
        <div className="room-pin-head"><strong>{pin.title}</strong><span className="room-pin-actions"><button type="button" disabled={locked} onClick={() => startEditPin(pin)}>Edit</button><button type="button" disabled={locked} onClick={() => void removePin(pin)}>Delete</button></span></div>
        <p>{pinPreview(pin.content)}</p>
      </li>)}</ul> : <p>No pins yet.</p>}
    </section>
    <section className="room-threads" aria-label="Threads">
      <div className="room-threads-head"><h2>Threads</h2><button type="button" className="privacy-button" disabled={locked} onClick={onNewThread}><Plus size={15} aria-hidden="true" /> New thread</button></div>
      {threads.length ? <ul>{threads.map((thread) => <li key={thread.id}><button type="button" onClick={() => onOpenThread(thread.id)}>{thread.title}</button></li>)}</ul> : <p>No threads in this room yet.</p>}
    </section>
    {error ? <p className="privacy-error" role="status">{error}</p> : null}
    <button type="button" className="privacy-button is-danger" disabled={locked} onClick={() => void remove()}>{saving === "delete" ? "Deleting…" : "Delete room"}</button>
  </div>;
}
