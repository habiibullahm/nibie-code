import type { UserPreferences } from "@/lib/preferences/types";
import type { ChatModel } from "@/lib/chat/validation";
import type { RoomContextInput } from "@/lib/context/room-context";

export type { RoomContextInput } from "@/lib/context/room-context";

export type ContextSourceType = "core" | "profile" | "room" | "pins" | "file" | "thread_summary" | "recent_messages" | "current_request";

export type ContextAuthority = "policy" | "untrusted_data";

export type ExclusionReason = "absent" | "not_needed" | "defaults_only" | "read_failed" | "budget" | "stale";

export type DialogueRole = "user" | "assistant";

export type ContextBlock = {
  id: ContextSourceType;
  authority: ContextAuthority;
  priority: number;
  required: boolean;
  text: string;
  tokenEstimate: number;
  included: boolean;
  exclusionReason: ExclusionReason | null;
  dialogueRole?: DialogueRole;
};

export type ContextSourceDiagnostic = {
  type: "profile" | "room" | "pins" | "file" | "thread_summary" | "recent_messages";
  label: "Your profile" | "This room" | "Pinned context" | "File context" | "Thread summary" | "Recent conversation";
  state: "included" | "not_used";
  reason: string;
};

// Explicitly selected room-file text. Omitted means this request did not ask for file context.
export type FileContextInput = {
  name: string;
  text: string;
};

export type ContextDiagnostics = {
  sources: ContextSourceDiagnostic[];
  recentMessageCount: number;
};

export type BudgetReport = {
  inputBudgetTokens: number;
  outputReserveTokens: number;
  estimatedTokens: number;
  truncated: boolean;
};

export type ContextPlan = {
  policyVersion: "context-policy-v1";
  blocks: ContextBlock[];
  diagnostics: ContextDiagnostics;
  budget: BudgetReport;
};

export type ModelContextCapabilities = {
  contextWindowTokens: number;
  maxOutputTokens: number;
};

export type ThreadMessage = {
  role: DialogueRole;
  content: string;
  position: number;
};

export type ThreadSummary = {
  objective: string;
  importantContext: string;
  decisions: string;
  completedWork: string;
  currentState: string;
  openQuestions: string;
  coversThroughPosition: number;
  updatedAt: string;
};

export type BuildContextInput = {
  // The resolved mode only selects output-style guidance; provider selection is unchanged.
  responseMode?: ChatModel;
  capabilities: ModelContextCapabilities;
  preferences: UserPreferences;
  preferenceReadFailed: boolean;
  summary: ThreadSummary | null;
  messages: ThreadMessage[];
  currentPosition: number;
  // Omitted or null for a general thread. Present only after the caller has authorized the room.
  room?: RoomContextInput | null;
  // Present only for files the caller already authorized for this request. Never every room file.
  files?: FileContextInput[] | null;
};

export class ContextBuildError extends Error {
  constructor() {
    super("Context could not be built.");
    this.name = "ContextBuildError";
  }
}
