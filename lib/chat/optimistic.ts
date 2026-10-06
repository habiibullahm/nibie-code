type AssistantRow = {
  id: string;
  role: string;
  position: number;
};

// A new message is rendered optimistically with a temporary assistant "thinking" row.
// If a server refresh lands after the real assistant row is persisted but before the
// SSE start event replaces that optimistic row, both would otherwise render at once.
// Prefer the real assistant row at the same position and keep the optimistic one only
// until a real row for that position exists.
export function suppressSupersededPendingAssistants<T extends AssistantRow>(rows: readonly T[]): T[] {
  const realAssistantPositions = new Set(
    rows
      .filter((row) => row.role === "assistant" && !row.id.startsWith("pending-"))
      .map((row) => row.position),
  );

  return rows.filter(
    (row) =>
      !(
        row.role === "assistant" &&
        row.id.startsWith("pending-") &&
        realAssistantPositions.has(row.position)
      ),
  );
}
