import type { ModelContextCapabilities } from "@/lib/context/context-types";

export const FETCH_CAP = 32;
export const PROTECTED_RECENT_COUNT = 6;
export const SUMMARY_TOKEN_CAP = 800;
export const ROOM_TOKEN_CAP = 1_200;
// Shared by every pin in one room. Whole pins are kept or dropped; pin text is never cut in half.
export const PIN_TOKEN_CAP = 800;
export const FILE_TOKEN_CAP = 1_500;
// Shared by every chat attachment in one request.
export const ATTACHMENT_TOKEN_CAP = 6_000;
// Shared by every web source in one request (under the file cap).
export const WEB_TOKEN_CAP = 1_200;
// Deep Research multi-source evidence budget (still bounded; evidence is chunked).
export const RESEARCH_WEB_TOKEN_CAP = 3_200;
// Shared by recalled user memories in one request (small, after web, before summary).
export const MEMORY_TOKEN_CAP = 700;

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function budgetLimits(capabilities: ModelContextCapabilities) {
  const outputReserveTokens = Math.min(capabilities.maxOutputTokens, Math.floor(capabilities.contextWindowTokens * 0.25));
  return { outputReserveTokens, inputBudgetTokens: capabilities.contextWindowTokens - outputReserveTokens };
}
