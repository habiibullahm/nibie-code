import { CANONICAL_MIME, MAX_EXTRACTED_CHARS, MAX_FILE_BYTES, type RoomFileExtension } from "@/lib/files/limits";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const mimeToExtension: Record<string, RoomFileExtension> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/comma-separated-values": "csv",
};

const binarySignatures: number[][] = [
  [0x89, 0x50, 0x4e, 0x47],
  [0xff, 0xd8, 0xff],
  [0x47, 0x49, 0x46, 0x38],
  [0x25, 0x50, 0x44, 0x46],
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xd0, 0xcf, 0x11, 0xe0],
];

export type InspectedRoomFile = {
  displayName: string;
  extension: RoomFileExtension;
  mimeType: (typeof CANONICAL_MIME)[RoomFileExtension];
  sizeBytes: number;
  text: string;
  truncated: boolean;
};

export type FileFailure = { error: string };

const unsupported = "That file type isn't supported. Use a .txt, .md, or .csv file.";

export function isUuid(value: string) {
  return uuidPattern.test(value);
}

export function displayFileName(filename: string): { name: string } | FileFailure {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..") || cleaned.includes("/") || cleaned.includes("\\")) {
    return { error: "Choose a file with a clear name." };
  }
  if ([...cleaned].length > 120) return { error: "That file name is too long." };
  if (!/\.(txt|md|csv)$/i.test(cleaned)) return { error: unsupported };
  return { name: cleaned };
}

function extensionOf(name: string): RoomFileExtension | null {
  const match = /\.(txt|md|csv)$/i.exec(name);
  return match ? match[1].toLowerCase() as RoomFileExtension : null;
}

function hasBinarySignature(bytes: Uint8Array) {
  if (bytes.includes(0)) return true;
  return binarySignatures.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}

function boundedText(value: string, max: number) {
  let count = 0;
  let end = 0;
  for (const char of value) {
    if (count === max) return { text: value.slice(0, end).trimEnd(), truncated: true };
    count += 1;
    end += char.length;
  }
  return { text: value, truncated: false };
}

// Filename, declared type, and bytes must agree. A name alone never makes a file acceptable.
export function inspectRoomFile(input: { filename: string; mimeType: string; bytes: Uint8Array }): InspectedRoomFile | FileFailure {
  if (input.bytes.byteLength <= 0) return { error: "That file is empty." };
  if (input.bytes.byteLength > MAX_FILE_BYTES) return { error: "That file is larger than 5 MB." };
  const named = displayFileName(input.filename);
  if ("error" in named) return named;
  const extension = extensionOf(named.name);
  if (!extension) return { error: unsupported };
  const declared = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const generic = declared === "" || declared === "application/octet-stream";
  if (!generic) {
    const fromMime = mimeToExtension[declared];
    if (!fromMime || fromMime !== extension) return { error: unsupported };
  }
  if (hasBinarySignature(input.bytes)) return { error: "That file isn't supported text." };
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    return { error: "That file isn't valid text." };
  }
  const text = decoded.replace(/^\uFEFF/, "").trim();
  if (!text) return { error: "That file has no text to use." };
  const bounded = boundedText(text, MAX_EXTRACTED_CHARS);
  if (!bounded.text) return { error: "That file has no text to use." };
  return {
    displayName: named.name,
    extension,
    mimeType: CANONICAL_MIME[extension],
    sizeBytes: input.bytes.byteLength,
    text: bounded.text,
    truncated: bounded.truncated,
  };
}

// The object key is always owner / room / generated id. Callers cannot supply a storage path.
export function buildRoomFilePath(ownerId: string, roomId: string, fileId: string, extension: RoomFileExtension) {
  if (!isUuid(ownerId) || !isUuid(roomId) || !isUuid(fileId)) return { error: "Choose a valid room file." } as const;
  return { path: `${ownerId}/${roomId}/${fileId}/${fileId}.${extension}` } as const;
}

export type StorageDeleteResult = "removed" | "missing" | "failed";

export function fileDeletionOutcome(storage: StorageDeleteResult, recordDeleted: boolean) {
  if (storage === "failed") return { complete: false as const, error: "The file is still saved because storage deletion failed." };
  if (!recordDeleted) return { complete: false as const, error: "The stored copy was removed, but the file record could not be deleted." };
  return { complete: true as const, error: null };
}

export function parseSelectedFileIds(value: unknown, max: number) {
  if (value === undefined) return { ok: true as const, ids: [] as string[] };
  if (!Array.isArray(value) || value.length > max) return { ok: false as const };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isUuid(item) || ids.includes(item)) return { ok: false as const };
    ids.push(item);
  }
  return { ok: true as const, ids };
}
