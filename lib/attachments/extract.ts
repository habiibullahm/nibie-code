import "server-only";

import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TEXT_CHARS, MAX_PDF_PAGES, type AttachmentMimeType } from "@/lib/attachments/limits";
import { attachmentErrors, checkAttachmentFile, type AttachmentFailure } from "@/lib/attachments/rules";

export type ExtractedAttachment = {
  name: string;
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  text: string;
  // True when the stored text is not the whole file: cut at the text limit, or later PDF pages not read.
  truncated: boolean;
  // Total pages in a PDF; null for text files.
  pageCount: number | null;
};

// Leading bytes of common binary formats. A text file that starts like one of these is rejected.
const binarySignatures: number[][] = [
  [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38], [0x25, 0x50, 0x44, 0x46],
  [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46],
  [0xd0, 0xcf, 0x11, 0xe0], [0x1f, 0x8b], [0x52, 0x49, 0x46, 0x46], [0x00, 0x00, 0x01, 0x00],
];

function looksBinary(bytes: Uint8Array) {
  if (bytes.includes(0)) return true;
  return binarySignatures.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}

function isPdf(bytes: Uint8Array) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

// Line endings to \n, control characters other than tab and newline removed, outer whitespace trimmed.
export function normalizeText(value: string) {
  return value.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

function bounded(value: string) {
  let count = 0;
  let end = 0;
  for (const char of value) {
    if (count === MAX_ATTACHMENT_TEXT_CHARS) return { text: value.slice(0, end).trimEnd(), truncated: true };
    count += 1;
    end += char.length;
  }
  return { text: value, truncated: false };
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number; pagesRead: number } | AttachmentFailure> {
  const { getDocumentProxy } = await import("unpdf");
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // A copy, because the parser may take ownership of the buffer. Nothing is fetched and no forms or scripts are rendered.
    document = await getDocumentProxy(new Uint8Array(bytes), { disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, disableAutoFetch: true, disableStream: true, enableXfa: false });
    const pageCount = document.numPages;
    const pagesRead = Math.min(pageCount, MAX_PDF_PAGES);
    const pages: string[] = [];
    let characters = 0;
    for (let index = 1; index <= pagesRead && characters <= MAX_ATTACHMENT_TEXT_CHARS; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "").join("");
      pages.push(text);
      characters += text.length;
    }
    return { text: pages.join("\n\n"), pageCount, pagesRead: pages.length };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { error: name === "PasswordException" ? attachmentErrors.pdfLocked : attachmentErrors.pdfUnreadable };
  } finally {
    await document?.cleanup().catch(() => undefined);
  }
}

// The name, the declared type and the bytes must all agree with a supported text, code or PDF file.
// Nothing in the file is executed, followed or unpacked: text is decoded, and PDF text is read page by page.
export async function extractAttachment(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<ExtractedAttachment | AttachmentFailure> {
  const checked = checkAttachmentFile({ name: input.filename, size: input.bytes.byteLength, type: input.mimeType });
  if ("error" in checked) return checked;
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) return { error: attachmentErrors.tooLarge };
  const mimeType = ATTACHMENT_TYPES[checked.extension].mime;
  if (mimeType === "application/pdf") {
    if (!isPdf(input.bytes)) return { error: attachmentErrors.pdfUnreadable };
    const read = await pdfText(input.bytes);
    if ("error" in read) return read;
    const text = normalizeText(read.text);
    if (!text) return { error: attachmentErrors.pdfNoText };
    const limited = bounded(text);
    return { name: checked.name, mimeType, sizeBytes: input.bytes.byteLength, text: limited.text, truncated: limited.truncated || read.pagesRead < read.pageCount, pageCount: read.pageCount };
  }
  if (looksBinary(input.bytes)) return { error: attachmentErrors.notText };
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    return { error: attachmentErrors.notText };
  }
  const text = normalizeText(decoded);
  if (!text) return { error: attachmentErrors.empty };
  const limited = bounded(text);
  return { name: checked.name, mimeType, sizeBytes: input.bytes.byteLength, text: limited.text, truncated: limited.truncated, pageCount: null };
}
