import type { UserPreferences } from "@/lib/preferences/types";
import type { ChatModel } from "@/lib/chat/validation";
import type { RoomContextInput } from "@/lib/context/room-context";
import type { MemoryRecord, RecallOperationStatus } from "@/lib/recall/types";
import type { WebContextInput } from "@/lib/web/types";

export type { RoomContextInput } from "@/lib/context/room-context";
export type { WebContextInput } from "@/lib/web/types";

export type ContextSourceType = "core" | "profile" | "room" | "pins" | "file" | "attachment" | "web" | "memory" | "thread_summary" | "recent_messages" | "current_request";

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
  type: "profile" | "room" | "pins" | "file" | "attachment" | "web" | "memory" | "thread_summary" | "recent_messages";
  label: "Your profile" | "This room" | "Pinned context" | "File context" | "Attachments" | "Web sources" | "Saved memories" | "Thread summary" | "Recent conversation";
  state: "included" | "not_used";
  reason: string;
};

// Explicitly selected room-file text. Omitted means this request did not ask for file context.
export type FileContextInput = {
  id?: string;
  name: string;
  text: string;
  truncated?: boolean;
  excerpt?: boolean;
};

// Text of a file the user attached to one of their messages in this conversation, already authorized for this owner
// and conversation. Chat attachments are not room files and never come from another thread.
export type AttachmentContextInput = {
  name: string;
  typeLabel: string;
  text: string;
  // The saved text is not the whole file (cut at the text limit, or PDF pages beyond the page limit).
  truncated: boolean;
  pageCount: number | null;
  // Attached to the message being answered, rather than to an earlier one.
  current: boolean;
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
  // Attachments of this conversation's messages in context, current message first. Omitted when there are none.
  attachments?: AttachmentContextInput[] | null;
  // Public web sources already retrieved and SSRF-checked for this request. Omitted when routing skipped web or retrieval failed.
  web?: WebContextInput[] | null;
  // True when capability routing wanted web but sources were empty (unconfigured, provider fail, empty pipeline).
  webVerificationUnavailable?: boolean;
  // Explicit user-owned memories already retrieved for this request. Omitted when recall is off or none matched.
  memories?: MemoryRecord[] | null;
  // Outcome of an explicit remember/forget on this turn. Authoritative; not untrusted memory content.
  recallOperation?: RecallOperationStatus | null;
};

export class ContextBuildError extends Error {
  constructor() {
    super("Context could not be built.");
    this.name = "ContextBuildError";
  }
}
