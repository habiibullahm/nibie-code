import { randomUUID } from "node:crypto";
import { buildRoomFilePath, fileDeletionOutcome, inspectRoomFile, type StorageDeleteResult } from "@/lib/files/inspect";
import { MAX_ROOM_FILES, ROOM_FILES_BUCKET } from "@/lib/files/limits";
import type { RoomFileSummary } from "@/lib/files/types";

type QueryError = { message?: string; code?: string } | null;

type RowQuery = {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => RowQuery;
  eq: (column: string, value: string) => RowQuery;
  in: (column: string, values: string[]) => RowQuery;
  order: (column: string, options: { ascending: boolean }) => RowQuery;
  limit: (count: number) => RowQuery;
  insert: (row: Record<string, unknown>) => RowQuery;
  delete: () => RowQuery;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: QueryError }>;
  then: (resolve: (value: { data: unknown; error: QueryError; count?: number | null }) => unknown) => Promise<unknown>;
};

export type RoomFileClient = {
  from: (table: string) => RowQuery;
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }) => Promise<{ error: QueryError }>;
      remove: (paths: string[]) => Promise<{ error: QueryError }>;
    };
  };
};

const unavailable = "That room is no longer available.";
const saveFailed = "We couldn't save that file. Please try again.";
const listFailed = "Files couldn't be loaded. Please try again.";
const missingFile = "That file is no longer available.";

function storageResult(error: QueryError): StorageDeleteResult {
  if (!error) return "removed";
  const message = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  if (message.includes("not found") || message.includes("does not exist") || error.code === "404") return "missing";
  return "failed";
}

export async function listRoomFiles(client: RoomFileClient, roomId: string): Promise<{ data?: RoomFileSummary[]; error?: string }> {
  const { data: room, error: roomError } = await client.from("rooms").select("id").eq("id", roomId).maybeSingle();
  if (roomError) return { error: listFailed };
  if (!room) return { error: unavailable };
  const listed = await client.from("room_files").select("id,original_name,mime_type,size_bytes,created_at").eq("room_id", roomId).order("created_at", { ascending: true });
  const { data, error } = await Promise.resolve(listed).then((value) => value as { data: RoomFileSummary[] | null; error: QueryError });
  if (error || !data) return { error: listFailed };
  return {
    data: data.map((row) => ({
      id: row.id,
      original_name: row.original_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    })),
  };
}

export async function saveRoomFile(client: RoomFileClient, ownerId: string, roomId: string, file: { filename: string; mimeType: string; bytes: Uint8Array }) {
  const inspected = inspectRoomFile(file);
  if ("error" in inspected) return { error: inspected.error };
  const { data: room, error: roomError } = await client.from("rooms").select("id").eq("id", roomId).maybeSingle();
  if (roomError) return { error: saveFailed };
  if (!room) return { error: unavailable };
  const counted = await client.from("room_files").select("id", { count: "exact", head: true }).eq("room_id", roomId);
  const countResult = await Promise.resolve(counted).then((value) => value as { count?: number | null; error: QueryError; data: unknown });
  if (countResult.error) return { error: saveFailed };
  if ((countResult.count ?? 0) >= MAX_ROOM_FILES) return { error: "This room already has 20 files." };

  const fileId = randomUUID();
  const stored = buildRoomFilePath(ownerId, roomId, fileId, inspected.extension);
  if ("error" in stored) return { error: saveFailed };
  const uploaded = await client.storage.from(ROOM_FILES_BUCKET).upload(stored.path, file.bytes, { contentType: inspected.mimeType, upsert: false });
  if (uploaded.error) return { error: saveFailed };

  const inserted = await client.from("room_files").insert({
    id: fileId,
    user_id: ownerId,
    room_id: roomId,
    original_name: inspected.displayName,
    mime_type: inspected.mimeType,
    size_bytes: inspected.sizeBytes,
    storage_path: stored.path,
    extracted_text: inspected.text,
  }).select("id,original_name,mime_type,size_bytes,created_at").maybeSingle();
  if (inserted.error || !inserted.data) {
    await client.storage.from(ROOM_FILES_BUCKET).remove([stored.path]);
    return { error: saveFailed };
  }
  const row = inserted.data as RoomFileSummary;
  return {
    data: {
      id: String(row.id),
      original_name: String(row.original_name),
      mime_type: String(row.mime_type),
      size_bytes: Number(row.size_bytes),
      created_at: String(row.created_at),
    },
  };
}

export async function deleteRoomFile(client: RoomFileClient, ownerId: string, roomId: string, fileId: string) {
  const { data, error } = await client.from("room_files").select("id,storage_path").eq("id", fileId).eq("room_id", roomId).maybeSingle();
  if (error) return { error: saveFailed };
  if (!data) return { error: missingFile };
  const storagePath = String(data.storage_path ?? "");
  if (!storagePath.startsWith(`${ownerId}/${roomId}/`)) return { error: missingFile };
  const removed = await client.storage.from(ROOM_FILES_BUCKET).remove([storagePath]);
  const storage = storageResult(removed.error);
  if (storage === "failed") return fileDeletionOutcome(storage, false);
  const deleted = await client.from("room_files").delete().eq("id", fileId).eq("room_id", roomId).select("id").maybeSingle();
  return fileDeletionOutcome(storage, !deleted.error && Boolean(deleted.data));
}

export async function deleteRoomFileObjects(client: RoomFileClient, ownerId: string, roomId: string) {
  const listed = await client.from("room_files").select("storage_path").eq("room_id", roomId);
  const { data, error } = await Promise.resolve(listed).then((value) => value as { data: { storage_path: string }[] | null; error: QueryError });
  if (error || !data) return { error: "The room is still here because its files could not be listed." };
  const paths = data.map((row) => row.storage_path).filter((path) => path.startsWith(`${ownerId}/`));
  if (!paths.length) return {};
  const removed = await client.storage.from(ROOM_FILES_BUCKET).remove(paths);
  if (removed.error) return { error: "The room is still here because its files could not be removed from storage." };
  return {};
}
