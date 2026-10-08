export const operationalCodes = {
  aiProviderFailed: "AI_PROVIDER_FAILED",
  contextBuildFailed: "CONTEXT_BUILD_FAILED",
  assistantPersistFailed: "ASSISTANT_PERSIST_FAILED",
  authRequired: "AUTH_REQUIRED",
  invalidOrigin: "INVALID_ORIGIN",
  preferenceReadFailed: "PREFERENCE_READ_FAILED",
  requestFailed: "REQUEST_FAILED",
  weeklyUsageLimitRejected: "WEEKLY_USAGE_LIMIT",
  aiSpendLimitRejected: "AI_SPEND_LIMIT",
  roomDraftFailed: "ROOM_DRAFT_FAILED",
  attachmentSaveFailed: "ATTACHMENT_SAVE_FAILED",
  attachmentReadFailed: "ATTACHMENT_READ_FAILED",
  webSearchFailed: "WEB_SEARCH_FAILED",
  recallWriteFailed: "RECALL_WRITE_FAILED",
  recallRetrieveFailed: "RECALL_RETRIEVE_FAILED",
  deepResearchFailed: "DEEP_RESEARCH_FAILED",
} as const;

export type OperationalCode = (typeof operationalCodes)[keyof typeof operationalCodes];
