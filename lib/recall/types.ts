export const memoryTypes = ["preference", "project", "instruction", "fact"] as const;
export type MemoryType = (typeof memoryTypes)[number];

export const memoryContentLimit = 1000;
export const memoryKeyLimit = 200;
export const MEMORY_RETRIEVE_MAX = 5;
/** Bounded candidate pool for chat-turn ranking only. Not for Settings or forget. */
export const MEMORY_RETRIEVE_CANDIDATE_CAP = 80;
/** Page size for Settings listing / full scans. */
export const MEMORY_SETTINGS_PAGE_SIZE = 50;
/** Safety ceiling when paging Settings or forget/topic scans. */
export const MEMORY_LIST_HARD_CAP = 2000;
export const MEMORY_TOKEN_CAP = 700;

export const recallOperationStatuses = [
  "none",
  "save_succeeded",
  "save_failed",
  "memory_disabled",
  "forget_succeeded",
  "forget_not_found",
  "forget_failed",
] as const;
export type RecallOperationStatus = (typeof recallOperationStatuses)[number];

export type MemoryRecord = {
  id: string;
  type: MemoryType;
  content: string;
  normalizedKey: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type MemoryDraft = {
  type: MemoryType;
  content: string;
  normalizedKey: string;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
};

export type MemoryIntent =
  | { kind: "none" }
  | { kind: "save"; raw: string }
  | { kind: "forget"; raw: string };

export type RankedMemory = MemoryRecord & {
  score: number;
  exactIdentifier: boolean;
};
