export const memoryTypes = ["preference", "project", "instruction", "fact"] as const;
export type MemoryType = (typeof memoryTypes)[number];

export const memoryContentLimit = 1000;
export const memoryKeyLimit = 200;
export const MEMORY_RETRIEVE_MAX = 5;
export const MEMORY_RETRIEVE_CANDIDATE_CAP = 80;
export const MEMORY_TOKEN_CAP = 700;

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
