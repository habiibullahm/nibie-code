// Chat attachment limits. One place for the client, the upload route, the database checks and the context budget.

export const MAX_ATTACHMENTS_PER_MESSAGE = 3;

// Per-file upload cap. Each file is its own upload request.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// All attachments of one message together (2× the per-file cap).
export const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

// Text kept per attachment. Longer files are cut here and marked truncated.
export const MAX_ATTACHMENT_TEXT_CHARS = 24_000;

// Pages read from a PDF. Later pages are not read and the attachment is marked truncated.
export const MAX_PDF_PAGES = 50;

// Unsent drafts one account may hold at a time, and how long an abandoned draft is kept.
export const MAX_DRAFT_ATTACHMENTS = 20;
export const DRAFT_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export const ATTACHMENT_ACCEPT = ".txt,.md,.markdown,.json,.csv,.pdf,.ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.sql,.html,.css,.yaml,.yml,.xml";

export const ATTACHMENT_TYPES = {
  txt: { mime: "text/plain", label: "Text" },
  md: { mime: "text/markdown", label: "Markdown" },
  markdown: { mime: "text/markdown", label: "Markdown" },
  csv: { mime: "text/csv", label: "CSV" },
  json: { mime: "application/json", label: "JSON" },
  pdf: { mime: "application/pdf", label: "PDF" },
  ts: { mime: "text/x-typescript", label: "TypeScript" },
  tsx: { mime: "text/x-typescript", label: "TypeScript" },
  js: { mime: "text/javascript", label: "JavaScript" },
  jsx: { mime: "text/javascript", label: "JavaScript" },
  py: { mime: "text/x-python", label: "Python" },
  java: { mime: "text/x-java", label: "Java" },
  go: { mime: "text/x-go", label: "Go" },
  rs: { mime: "text/x-rust", label: "Rust" },
  sql: { mime: "application/sql", label: "SQL" },
  html: { mime: "text/html", label: "HTML" },
  css: { mime: "text/css", label: "CSS" },
  yaml: { mime: "application/yaml", label: "YAML" },
  yml: { mime: "application/yaml", label: "YAML" },
  xml: { mime: "application/xml", label: "XML" },
} as const;

export type AttachmentExtension = keyof typeof ATTACHMENT_TYPES;
export type AttachmentMimeType = (typeof ATTACHMENT_TYPES)[AttachmentExtension]["mime"];

const labels = new Map<string, string>(Object.values(ATTACHMENT_TYPES).map((type) => [type.mime, type.label]));

export function attachmentTypeLabel(mime: string) {
  return labels.get(mime) ?? "File";
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", "tif", "tiff", "avif"];

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
