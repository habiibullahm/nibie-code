import { ROOM_FILE_CHUNK_CHARS, ROOM_FILE_CHUNK_OVERLAP } from "@/lib/files/limits";

export function chunkRoomFileText(text: string) {
  const chunks: { index: number; text: string }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + ROOM_FILE_CHUNK_CHARS);
    if (end < text.length && end > start) {
      const previous = text.charCodeAt(end - 1);
      const next = text.charCodeAt(end);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    }
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + 1500) end = boundary;
    }
    const part = text.slice(start, end).trim();
    if (part) chunks.push({ index: chunks.length, text: part });
    if (end >= text.length) break;
    let nextStart = Math.max(start + 1, end - ROOM_FILE_CHUNK_OVERLAP);
    if (nextStart < text.length) {
      const previous = text.charCodeAt(nextStart - 1);
      const next = text.charCodeAt(nextStart);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) nextStart++;
    }
    start = nextStart;
  }
  return chunks;
}
