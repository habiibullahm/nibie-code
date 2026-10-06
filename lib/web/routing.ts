import type { WebRouteDecision, WebRouteReason } from "@/lib/web/types";

export type WebSearchRule = {
  reason: WebRouteReason;
  search: boolean;
  pattern: RegExp;
};

/** Exported for tests. Search rules are evaluated before no-search heuristics. */
export const WEB_SEARCH_RULES: readonly WebSearchRule[] = [
  {
    reason: "explicit_request",
    search: true,
    pattern:
      /\b(?:search(?:\s+the)?\s+web|look\s+up\s+online|find\s+online|google|browse\s+(?:the\s+)?web|web\s+search|look\s+this\s+up|check\s+online)\b/i,
  },
  {
    reason: "temporal_currency",
    search: true,
    pattern:
      /\b(?:latest|current|today|recent(?:ly)?|this\s+week|right\s+now|as\s+of|up[- ]to[- ]date)\b/i,
  },
  {
    reason: "news",
    search: true,
    pattern: /\b(?:news|headlines|breaking)\b/i,
  },
  {
    reason: "prices_markets",
    search: true,
    pattern:
      /\b(?:price|prices|stock(?:s)?|share\s+price|fx|forex|exchange\s+rate|crypto|bitcoin|ethereum|spot\s+price|market\s+price)\b/i,
  },
  {
    reason: "schedules",
    search: true,
    pattern: /\b(?:schedule|timetable|kickoff|kick-off|airs|airing|fixture)\b/i,
  },
  {
    reason: "releases_versions",
    search: true,
    pattern:
      /\b(?:release|released|version|changelog|what'?s\s+new\s+in|cve-\d+|cve\b)\b/i,
  },
  {
    reason: "public_figures",
    search: true,
    pattern:
      /\b(?:ceo|president|leadership|who\s+is\s+the\s+current|current\s+(?:ceo|president|cto|cfo|prime\s+minister|mayor))\b/i,
  },
  {
    reason: "current_docs",
    search: true,
    pattern:
      /\b(?:current\s+docs|official\s+docs|api\s+reference|latest\s+docs|documentation\s+for)\b/i,
  },
  {
    reason: "jobs",
    search: true,
    pattern: /\b(?:job(?:s)?|hiring|careers?\s+posting|job\s+posting|open\s+roles?)\b/i,
  },
  {
    reason: "public_info_stale",
    search: true,
    // Requires a currency cue elsewhere in the query (checked in decideWebSearch).
    pattern: /\b(?:who\s+owns|market\s+share|regulation|regulated\s+by)\b/i,
  },
] as const;

const ROOM_SUFFICIENT_PATTERN =
  /\b(?:based\s+on\s+this\s+file|based\s+on\s+the\s+(?:attached|room)\s+file|in\s+this\s+room|from\s+(?:the\s+)?(?:attached|room)\s+file|using\s+(?:only\s+)?(?:this|the)\s+(?:file|attachment|room)|summarize\s+(?:this|the)\s+(?:file|attachment|document)|according\s+to\s+(?:this|the)\s+file)\b/i;

const CONCEPTUAL_PATTERN =
  /\b(?:explain|how\s+does|how\s+do|what\s+is|what\s+are|teach\s+me|why\s+(?:is|are|do|does)|concept\s+of|difference\s+between)\b/i;

const PURE_WRITING_PATTERN =
  /\b(?:rewrite|rephrase|draft|edit|proofread|tone|make\s+(?:this|it)\s+(?:shorter|longer|clearer|more\s+formal|more\s+casual)|polish\s+(?:this|my))\b/i;

const GENERIC_CODING_PATTERN =
  /\b(?:bug|fix|refactor|implement|function|typescript|javascript|python|code\s+review|unit\s+test|compile\s+error|type\s+error)\b/i;

const CURRENCY_CUE_PATTERN =
  /\b(?:latest|current|today|recent(?:ly)?|this\s+week|right\s+now|as\s+of|up[- ]to[- ]date)\b/i;

export type DecideWebSearchOpts = {
  hasRoomFileContext?: boolean;
};

/**
 * Deterministic capability routing for web search. No LLM.
 * Empty/whitespace → no search. Room-only grounding can skip web when file context exists.
 * First matching search rule wins; otherwise a no-search reason is returned.
 */
export function decideWebSearch(query: string, opts?: DecideWebSearchOpts): WebRouteDecision {
  const text = query.trim();
  if (!text) {
    return { search: false, reason: "default_no_search" };
  }

  // Explicit web/search request always searches (even with room files).
  const explicit = matchRule(text, "explicit_request");
  if (explicit) return explicit;

  // Room-grounded asks with available file context skip web.
  if (opts?.hasRoomFileContext && ROOM_SUFFICIENT_PATTERN.test(text)) {
    return { search: false, reason: "room_sufficient" };
  }

  // Stale public-info patterns need a currency cue; prefer this reason over bare temporal.
  const staleRule = WEB_SEARCH_RULES.find((rule) => rule.reason === "public_info_stale");
  if (staleRule?.pattern.test(text) && CURRENCY_CUE_PATTERN.test(text)) {
    return { search: true, reason: "public_info_stale" };
  }

  for (const rule of WEB_SEARCH_RULES) {
    if (!rule.search || rule.reason === "explicit_request" || rule.reason === "public_info_stale") {
      continue;
    }
    if (rule.pattern.test(text)) {
      return { search: true, reason: rule.reason };
    }
  }

  if (PURE_WRITING_PATTERN.test(text)) {
    return { search: false, reason: "pure_writing" };
  }
  if (GENERIC_CODING_PATTERN.test(text) && !CURRENCY_CUE_PATTERN.test(text)) {
    return { search: false, reason: "generic_coding" };
  }
  if (CONCEPTUAL_PATTERN.test(text)) {
    return { search: false, reason: "conceptual" };
  }

  return { search: false, reason: "default_no_search" };
}

function matchRule(text: string, reason: WebRouteReason): WebRouteDecision | null {
  const rule = WEB_SEARCH_RULES.find((entry) => entry.reason === reason);
  if (!rule || !rule.pattern.test(text)) return null;
  return { search: rule.search, reason: rule.reason };
}
