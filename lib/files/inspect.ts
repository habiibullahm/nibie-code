import { CANONICAL_MIME, MAX_EXTRACTED_CHARS, MAX_FILE_BYTES, type RoomFileExtension } from "@/lib/files/limits";
import { getResolvedPDFJS } from "unpdf";
import { inflateRawSync } from "node:zlib";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const mimeToExtensions: Record<string, RoomFileExtension[]> = Object.fromEntries(Object.entries(CANONICAL_MIME).map(([ext, mime]) => [mime, [ext as RoomFileExtension]]));
Object.assign(mimeToExtensions, { "text/x-markdown": ["md"], "application/csv": ["csv"], "text/comma-separated-values": ["csv"], "text/typescript": ["ts", "tsx"], "application/typescript": ["ts", "tsx"], "text/x-typescript": ["ts", "tsx"], "text/javascript": ["js", "jsx"], "application/javascript": ["js", "jsx"], "text/x-python": ["py"], "text/x-java-source": ["java"], "text/x-java": ["java"], "text/x-go": ["go"], "text/x-rust": ["rs"], "application/yaml": ["yaml", "yml"], "text/yaml": ["yaml", "yml"], "text/x-yaml": ["yaml", "yml"], "application/x-yaml": ["yaml", "yml"], "application/xml": ["xml"], "text/xml": ["xml"], "text/x-sql": ["sql"] });

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

const supportedExtensions = Object.keys(CANONICAL_MIME).join(", .");
const unsupported = `That file type isn't supported. Use a .${supportedExtensions} file.`;

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
  if (!new RegExp(`\\.(${Object.keys(CANONICAL_MIME).join("|")})$`, "i").test(cleaned)) return { error: unsupported };
  return { name: cleaned };
}

function extensionOf(name: string): RoomFileExtension | null {
  const match = new RegExp(`\\.(${Object.keys(CANONICAL_MIME).join("|")})$`, "i").exec(name);
  return match ? match[1].toLowerCase() as RoomFileExtension : null;
}

function hasBinarySignature(bytes: Uint8Array) {
  if (bytes.includes(0)) return true;
  return binarySignatures.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}

function hasBinaryControls(text: string) {
  let controls = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) controls++;
  }
  return controls > 0;
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
function decodeXml(value: string) { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }

function extractDocx(bytes: Uint8Array): string {
  const b = Buffer.from(bytes);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("corrupt");
  const count = b.readUInt16LE(end + 10), centralSize = b.readUInt32LE(end + 12), centralAt = b.readUInt32LE(end + 16);
  if (count > 512 || centralSize > 256_000 || centralAt + centralSize > end) throw new Error("unsafe");
  let p = centralAt;
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt");
    const method = b.readUInt16LE(p + 10), compressed = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24), nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), localAt = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    if (size > 12 * 1024 * 1024 || compressed > 10 * 1024 * 1024 || size > Math.max(1, compressed) * 100) throw new Error("unsafe");
    if (name === "word/document.xml") {
      if (b.readUInt32LE(localAt) !== 0x04034b50) throw new Error("corrupt");
      const dataAt = localAt + 30 + b.readUInt16LE(localAt + 26) + b.readUInt16LE(localAt + 28);
      const packed = b.subarray(dataAt, dataAt + compressed);
      const xml = method === 0 ? packed.toString("utf8") : method === 8 ? inflateRawSync(packed, { maxOutputLength: 12 * 1024 * 1024 }).toString("utf8") : "";
      if (!xml || xml.length > 12 * 1024 * 1024) throw new Error("corrupt");
      return decodeXml(xml.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, ""));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("corrupt");
}

type PdfJsModule = Awaited<ReturnType<typeof getResolvedPDFJS>>;
type PdfLoadingTask = ReturnType<PdfJsModule["getDocument"]>;
type PdfDocument = Awaited<PdfLoadingTask["promise"]>;

async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; truncated: boolean } | FileFailure> {
  let document: PdfDocument | undefined;
  let loadingTask: PdfLoadingTask | undefined;
  let taskDestroyed = false;
  try {
    const pdfjs = await getResolvedPDFJS();
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, disableAutoFetch: true, disableStream: true, enableXfa: false });
    document = await loadingTask.promise;
    if (document.numPages > 100) return { error: "That PDF has too many pages to extract safely (maximum 100)." };
    const pagesRead = Math.min(document.numPages, 50);
    const pages: string[] = [];
    let remaining = MAX_EXTRACTED_CHARS;
    let truncated = pagesRead < document.numPages;
    for (let pageNumber = 1; pageNumber <= pagesRead && remaining > 0; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
      let pageText = "";
      let pageTruncated = false;
      try {
        while (!pageTruncated) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of value.items) {
            if (!("str" in item)) continue;
            const segment = item.str + (item.hasEOL ? "\n" : "");
            for (const char of segment) {
              if (remaining === 0) {
                pageTruncated = true;
                break;
              }
              pageText += char;
              remaining--;
            }
            if (pageTruncated) break;
            if (remaining === 0) {
              // Reaching the cap is conservatively partial: more text may follow in another item/page.
              pageTruncated = true;
              break;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (pageTruncated) {
        truncated = true;
        if (remaining === 0) {
          await loadingTask.destroy();
          taskDestroyed = true;
        }
      }
      pages.push(pageText);
    }
    const text = pages.join("\n\n");
    if (!text.trim()) return { error: "That PDF contains no extractable text. Scanned PDFs aren't supported." };
    return { text, truncated };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") return { error: "That PDF is password-protected." };
    return { error: "That PDF is corrupt or couldn't be read." };
  } finally {
    if (!taskDestroyed) await loadingTask?.destroy().catch(() => undefined);
  }
}

export async function inspectRoomFile(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<InspectedRoomFile | FileFailure> {
  if (input.bytes.byteLength <= 0) return { error: "That file is empty." };
  if (input.bytes.byteLength > MAX_FILE_BYTES) return { error: "That file is larger than 5 MB." };
  const named = displayFileName(input.filename);
  if ("error" in named) return named;
  const extension = extensionOf(named.name);
  if (!extension) return { error: unsupported };
  const declared = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const generic = declared === "" || declared === "application/octet-stream";
  if (!generic) {
    const fromMime = mimeToExtensions[declared];
    if (!fromMime?.includes(extension)) return { error: unsupported };
  }
  let decoded: string;
  let pdfTruncated = false;
  try {
    if (extension === "pdf") {
      if (input.bytes[0] !== 0x25 || input.bytes[1] !== 0x50 || input.bytes[2] !== 0x44 || input.bytes[3] !== 0x46) return { error: "That PDF is corrupt or invalid." };
      const extracted = await extractPdfText(input.bytes);
      if ("error" in extracted) return extracted;
      decoded = extracted.text;
      pdfTruncated = extracted.truncated;
    } else if (extension === "docx") {
      if (!(input.bytes[0] === 0x50 && input.bytes[1] === 0x4b)) return { error: "That DOCX file is corrupt or invalid." };
      decoded = extractDocx(input.bytes);
    } else {
      if (hasBinarySignature(input.bytes)) return { error: "That file isn't supported text." };
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      if (hasBinaryControls(decoded)) return { error: "That file isn't readable text." };
    }
  } catch {
    return { error: extension === "pdf" ? "That PDF is locked, corrupt, or couldn't be read." : extension === "docx" ? "That DOCX file is corrupt or couldn't be read." : "That file isn't valid text." };
  }
  const text = decoded.replace(/^\uFEFF/, "");
  if (!text.trim()) return { error: "That file has no text to use." };
  const bounded = boundedText(text, MAX_EXTRACTED_CHARS);
  if (!bounded.text.trim()) return { error: "That file has no text to use." };
  return {
    displayName: named.name,
    extension,
    mimeType: CANONICAL_MIME[extension],
    sizeBytes: input.bytes.byteLength,
    text: bounded.text,
    truncated: bounded.truncated || pdfTruncated,
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
