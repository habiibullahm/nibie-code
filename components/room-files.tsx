"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { deleteRoomFileAction, listRoomFilesAction } from "@/app/actions/files";
import type { RoomFileSummary } from "@/lib/files/types";

type Props = {
  roomId: string;
  disabled: boolean;
  preview?: boolean;
};

function typeLabel(mime: string) {
  if (mime === "text/markdown") return "MD";
  if (mime === "text/csv") return "CSV";
  return "TXT";
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function RoomFiles({ roomId, disabled, preview = false }: Props) {
  const [files, setFiles] = useState<RoomFileSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "uploading">(preview ? "ready" : "loading");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preview) return;
    let active = true;
    void listRoomFilesAction(roomId).then((result) => {
      if (!active) return;
      if (result.error) setError(result.error);
      else setFiles(result.data ?? []);
      setStatus("ready");
    });
    return () => { active = false; };
  }, [preview, roomId]);

  async function upload(file: File) {
    setStatus("uploading");
    setError("");
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch(`/api/rooms/${roomId}/files`, { method: "POST", body });
      const payload = await response.json().catch(() => null) as { error?: string; file?: RoomFileSummary } | null;
      if (!response.ok || !payload?.file) {
        setError(payload?.error ?? "We couldn't save that file. Please try again.");
        setStatus("ready");
        return;
      }
      setFiles((current) => [...current, payload.file!]);
      setStatus("ready");
    } catch {
      setError("We couldn't save that file. Please try again.");
      setStatus("ready");
    }
  }

  async function remove(file: RoomFileSummary) {
    setError("");
    const result = await deleteRoomFileAction(roomId, file.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFiles((current) => current.filter((item) => item.id !== file.id));
  }

  const locked = disabled || status === "uploading";

  return <section className="room-files" aria-label="Files">
    <div className="room-files-head">
      <h2>Files</h2>
      <button type="button" className="privacy-button" disabled={locked} onClick={() => preview ? setError("This preview isn't connected.") : inputRef.current?.click()}>
        <Plus size={15} aria-hidden="true" /> Add file
      </button>
      <input ref={inputRef} className="room-file-input" type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" aria-label="Choose a text file" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void upload(file);
      }} />
    </div>
    <p>Text files Nibie can use when you attach them in a thread. Nothing here is added to every message.</p>
    {status === "uploading" ? <p role="status">Uploading…</p> : null}
    {files.length ? <ul>{files.map((file) => <li className="room-file" key={file.id}>
      <span className="room-file-copy"><strong title={file.original_name}>{file.original_name}</strong><small>{typeLabel(file.mime_type)} · {sizeLabel(file.size_bytes)}</small></span>
      <button type="button" className="privacy-button" disabled={locked} onClick={() => void remove(file)}>Delete</button>
    </li>)}</ul> : status === "loading" ? <p role="status">Loading files…</p> : status === "uploading" ? null : <p>No files in this room yet.</p>}
    {error ? <p className="privacy-error" role="status">{error}</p> : null}
  </section>;
}
