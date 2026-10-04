const storageKey = "nibie.room-file-selection";

function readMap(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function rememberRoomFileSelection(messageId: string, fileIds: string[]) {
  if (typeof window === "undefined") return;
  try {
    const map = readMap();
    if (fileIds.length) map[messageId] = fileIds;
    else delete map[messageId];
    window.sessionStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // Blocked storage only affects regenerate-after-refresh. The current request still sends the selection.
  }
}

export function readRoomFileSelection(messageId: string) {
  const value = readMap()[messageId];
  return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
}
