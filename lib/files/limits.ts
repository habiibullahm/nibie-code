export const ROOM_FILES_BUCKET = "room-files";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const MAX_EXTRACTED_CHARS = 24_000;
export const ROOM_FILE_CHUNK_CHARS = 2400;
export const ROOM_FILE_CHUNK_OVERLAP = 240;

export const MAX_ROOM_FILES = 20;

export const MAX_FILES_PER_MESSAGE = 3;

export const FILE_EXTENSIONS = ["txt", "md", "csv", "json", "pdf", "docx", "ts", "tsx", "js", "jsx", "py", "java", "go", "rs", "sql", "html", "css", "yaml", "yml", "xml"] as const;

export type RoomFileExtension = (typeof FILE_EXTENSIONS)[number];

export const CANONICAL_MIME = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ts: "text/typescript", tsx: "text/typescript", js: "text/javascript", jsx: "text/javascript", py: "text/x-python", java: "text/x-java-source", go: "text/x-go", rs: "text/x-rust", sql: "application/sql", html: "text/html", css: "text/css", yaml: "application/yaml", yml: "application/yaml", xml: "application/xml",
} as const satisfies Record<RoomFileExtension, string>;
