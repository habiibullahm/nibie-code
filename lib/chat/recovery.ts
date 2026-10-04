import { ChatStreamServerError } from "@/lib/ai/sse";

// Decides what the client may conclude when a response stream ends badly. The server persists the terminal state of every
// generation, so only a failure the server reported itself is final; everything else must be confirmed against the server.
export const recoveryPollMs = 2500;
// Soft cap: give up only when the server snapshot is already idle. A generation can still be
// streaming past this (provider timeout is 120s; stale rows are recovered at 5 minutes).
export const recoveryMaxPolls = 30;
// Hard cap covers the server stale-generation window so a poll timeout cannot unlock Retry while a row is still streaming.
export const recoveryHardMaxPolls = 150;

export type StreamFailureKind =
  | "stopped" // the user pressed Stop
  | "in-progress" // 409: another generation is still running or a newer message exists
  | "server-error" // the stream carried an `error` event: the server saved a failed state
  | "request-failed" // an HTTP error before any stream: the server saved a failed state (or rejected the request)
  | "lost-connection"; // network error, truncated stream, or an unreadable stream: the outcome is unknown

export function classifyStreamFailure(input: { error: unknown; aborted: boolean; httpStatus?: number }): StreamFailureKind {
  if (input.aborted) return "stopped";
  if (input.httpStatus === 409) return "in-progress";
  if (input.error instanceof ChatStreamServerError) return "server-error";
  if (input.httpStatus !== undefined) return "request-failed";
  return "lost-connection";
}

export function needsServerCheck(kind: StreamFailureKind) {
  return kind === "stopped" || kind === "in-progress" || kind === "lost-connection";
}

type StatusRow = { id: string; role: string; status?: string; position: number };

// A stop-status acknowledgement can arrive before the partial text is persisted.
export function messagePersistenceConfirmed(local: { role: string; content: string; terminationReason?: "user_stopped" }, saved: { content: string; status?: string }) {
  if (saved.status === "streaming") return false;
  if (local.role === "user") return saved.content === local.content;
  return local.terminationReason !== "user_stopped" || saved.content.startsWith(local.content);
}

export function hasActiveGeneration(messages: readonly StatusRow[]) {
  return messages.some((message) => message.status === "streaming");
}

function sameSnapshot(left: readonly StatusRow[], right: readonly StatusRow[]) {
  if (left.length !== right.length) return false;
  const byId = new Map(right.map((row) => [row.id, row]));
  return left.every((row) => {
    const other = byId.get(row.id);
    return Boolean(other && other.status === row.status && other.position === row.position && other.role === row.role);
  });
}

const statusRank: Record<string, number> = { streaming: 1, interrupted: 2, error: 2, complete: 2 };

// A snapshot that rewinds a reply (complete → streaming, or drops a finished reply with no replacement) is an older poll arriving late.
export function isRegressiveSnapshot(current: readonly StatusRow[], incoming: readonly StatusRow[]) {
  for (const row of current) {
    const next = incoming.find((item) => item.id === row.id);
    if (!next) {
      if (row.role === "assistant" && row.status && row.status !== "streaming") {
        const replaced = incoming.some((item) => item.role === "assistant" && item.position >= row.position);
        if (!replaced) return true;
      }
      continue;
    }
    const from = statusRank[row.status ?? "complete"] ?? 2;
    const to = statusRank[next.status ?? "complete"] ?? 2;
    if (to < from) return true;
  }
  return false;
}

// Fresh server data settles a recovery once no response is running and, when we know which reply we were waiting for, that reply has a final state.
// `baseline` lets a deleted reply count as settled once a replacement at the same position has finished.
export function isRecoverySettled(messages: readonly StatusRow[], assistantId: string | null, baseline?: readonly StatusRow[] | null) {
  if (hasActiveGeneration(messages)) return false;
  if (assistantId === null) return true;
  const row = messages.find((message) => message.id === assistantId);
  if (row) return row.status !== "streaming";
  if (!baseline) return false;
  const previous = baseline.find((message) => message.id === assistantId);
  if (!previous) return false;
  return messages.some((message) => message.role === "assistant" && message.position >= previous.position && message.status !== "streaming");
}

// 409 / Stop before the streaming row is visible: an unchanged idle snapshot is not proof the in-flight generation finished.
export function unseenGenerationSettled(baseline: readonly StatusRow[], messages: readonly StatusRow[]) {
  if (hasActiveGeneration(messages)) return false;
  return !sameSnapshot(baseline, messages);
}

export function activeAssistantId(messages: readonly StatusRow[]) {
  return messages.find((message) => message.role === "assistant" && message.status === "streaming")?.id ?? null;
}

// Keep polling through an active generation. Giving up at the soft cap is what unlocked Retry while the server still returned 409.
// At the hard cap, ask for one authoritative read first. A row that is still streaming after that read stays locked.
export function recoveryPollAction(polls: number, messages: readonly StatusRow[], finalCheckDone = false): "continue" | "final-check" | "give-up" | "hold" {
  if (polls >= recoveryHardMaxPolls) {
    if (!finalCheckDone) return "final-check";
    return hasActiveGeneration(messages) ? "hold" : "give-up";
  }
  if (polls >= recoveryMaxPolls && !hasActiveGeneration(messages)) return "give-up";
  return "continue";
}

// The hard cap never starts a generation. Streaming stays unresolved; a terminal snapshot may be adopted.
export function hardCapResolution(messages: readonly StatusRow[]) {
  if (hasActiveGeneration(messages)) return { locked: true, requestGeneration: false as const, notice: "refresh" as const };
  return { locked: false, requestGeneration: false as const, notice: null };
}

// Applies poll snapshots in order, dropping regressive ones, until the awaited generation is terminal.
export function reconcileRecovery(input: { assistantId: string | null; baseline: readonly StatusRow[]; snapshots: readonly (readonly StatusRow[])[]; awaitUnseen?: boolean }) {
  let accepted: readonly StatusRow[] = input.baseline;
  for (const snapshot of input.snapshots) {
    if (isRegressiveSnapshot(accepted, snapshot)) continue;
    accepted = snapshot;
    const settled = input.awaitUnseen
      ? unseenGenerationSettled(input.baseline, snapshot)
      : isRecoverySettled(snapshot, input.assistantId, input.baseline);
    if (settled) return { locked: false, adopted: snapshot };
  }
  return { locked: true, adopted: null as readonly StatusRow[] | null };
}

// After the server has settled, a failure is only worth showing when the latest reply really ended in an error.
export function latestReplyFailed(messages: readonly StatusRow[]) {
  const latest = messages.filter((message) => message.role === "assistant").sort((left, right) => right.position - left.position)[0];
  return latest?.status === "error";
}
