"use client";

import { useEffect, useState } from "react";
import { listRoomFilesAction } from "@/app/actions/files";
import { MAX_FILES_PER_MESSAGE } from "@/lib/files/limits";
import type { RoomFileSummary } from "@/lib/files/types";

type Props = {
  roomId: string;
  selectedIds: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
};

export function RoomFilePicker({ roomId, selectedIds, disabled, onChange }: Props) {
  const [files, setFiles] = useState<RoomFileSummary[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void listRoomFilesAction(roomId).then((result) => {
      if (!active) return;
      if (result.error) setError(result.error);
      else setFiles(result.data ?? []);
      setLoaded(true);
    });
    return () => { active = false; };
  }, [roomId]);

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((item) => item !== id));
      setError("");
      return;
    }
    if (selectedIds.length >= MAX_FILES_PER_MESSAGE) {
      setError("You can attach up to 3 files.");
      return;
    }
    onChange([...selectedIds, id]);
    setError("");
  }

  return <div className="file-picker" role="group" aria-label="Room files">
    {!loaded ? <p role="status">Loading files…</p> : files.length ? files.map((file) => <label key={file.id}>
      <input type="checkbox" checked={selectedIds.includes(file.id)} disabled={disabled} onChange={() => toggle(file.id)} />
      <span>{file.original_name}</span>
    </label>) : <p>{error || "No files in this room yet. Add one from the room page."}</p>}
    {files.length && error ? <p className="privacy-error" role="status">{error}</p> : null}
  </div>;
}
