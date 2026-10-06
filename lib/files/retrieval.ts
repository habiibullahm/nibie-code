import type { FileContextInput } from "@/lib/context/context-types";

export type RoomFileMatch = { file_id: string; chunk_index: number; original_name: string; content: string; extracted_truncated: boolean };

export function prioritizeRoomFileMatches(explicit: FileContextInput[], matches: RoomFileMatch[], maxChunks = 5) {
  const seenChunks = new Set<string>();
  const automatic: FileContextInput[] = [];
  for (const match of matches) {
    const chunkKey = `${match.file_id}:${match.chunk_index}`;
    if (seenChunks.has(chunkKey)) continue;
    seenChunks.add(chunkKey);
    if (explicit.some((file) => file.id === match.file_id)) continue;
    automatic.push({ name: match.original_name, text: match.content, truncated: match.extracted_truncated, excerpt: true });
    if (automatic.length >= maxChunks) break;
  }
  return [...explicit, ...automatic];
}
