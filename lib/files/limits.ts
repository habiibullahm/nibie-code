export const ROOM_FILES_BUCKET = "room-files";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const MAX_EXTRACTED_CHARS = 24_000;

export const MAX_ROOM_FILES = 20;

export const MAX_FILES_PER_MESSAGE = 3;

export const FILE_EXTENSIONS = ["txt", "md", "csv"] as const;

export type RoomFileExtension = (typeof FILE_EXTENSIONS)[number];

export const CANONICAL_MIME = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
} as const satisfies Record<RoomFileExtension, string>;
