import { ATTACHMENT_TYPES, IMAGE_EXTENSIONS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENTS_TOTAL_BYTES, type AttachmentExtension } from "@/lib/attachments/limits";

// Rules shared by the composer and the server. The server repeats every check and also inspects the bytes.

export const attachmentErrors = {
  unsupported: "That file type isn't supported. Attach text, Markdown, CSV, JSON, code, or a PDF.",
  image: "Images aren't supported yet. Attach text, code, or a PDF.",
  tooLarge: "That file is larger than 4 MB.",
  empty: "That file is empty.",
  tooMany: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`,
  totalTooLarge: "Attachments can be up to 8 MB together.",
  badName: "Choose a file with a clear name.",
  longName: "That file name is too long.",
  notText: "That file isn't readable text.",
  pdfNoText: "That PDF has no extractable text. Scanned PDFs aren't supported yet.",
  pdfUnreadable: "That PDF couldn't be read.",
  pdfLocked: "That PDF is password-protected.",
  unavailable: "An attachment is no longer available. Remove it and attach it again.",
  saveFailed: "We couldn't attach that file. Please try again.",
} as const;

export type AttachmentFailure = { error: string };

// The visible name: last path segment, no control characters, collapsed whitespace, 1–120 characters.
export function attachmentName(filename: string): { name: string; extension: AttachmentExtension } | AttachmentFailure {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.startsWith(".") && !cleaned.slice(1).includes(".")) return { error: attachmentErrors.badName };
  if ([...cleaned].length > 120) return { error: attachmentErrors.longName };
  const extension = /\.([a-z0-9]+)$/i.exec(cleaned)?.[1]?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.includes(extension)) return { error: attachmentErrors.image };
  if (!Object.hasOwn(ATTACHMENT_TYPES, extension)) return { error: attachmentErrors.unsupported };
  return { name: cleaned, extension: extension as AttachmentExtension };
}

// Checks that need only the name, declared type and size (the composer runs these before uploading).
export function checkAttachmentFile(file: { name: string; size: number; type: string }): { name: string; extension: AttachmentExtension } | AttachmentFailure {
  if (file.type.toLowerCase().startsWith("image/")) return { error: attachmentErrors.image };
  const named = attachmentName(file.name);
  if ("error" in named) return named;
  if (file.size <= 0) return { error: attachmentErrors.empty };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: attachmentErrors.tooLarge };
  return named;
}

// Count and combined size for one message.
export function checkAttachmentSet(sizes: number[]): AttachmentFailure | null {
  if (sizes.length > MAX_ATTACHMENTS_PER_MESSAGE) return { error: attachmentErrors.tooMany };
  if (sizes.reduce((sum, size) => sum + size, 0) > MAX_ATTACHMENTS_TOTAL_BYTES) return { error: attachmentErrors.totalTooLarge };
  return null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Attachment ids sent with a message: absent, or 1–3 distinct ids.
export function parseAttachmentIds(value: unknown): { ok: true; ids: string[] } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS_PER_MESSAGE) return { ok: false };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !uuidPattern.test(item) || ids.includes(item.toLowerCase())) return { ok: false };
    ids.push(item.toLowerCase());
  }
  return { ok: true, ids };
}
