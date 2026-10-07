import type { WebRouteDecision, WebRouteReason } from "@/lib/web/types";

export type WebSearchRule = {
  reason: WebRouteReason;
  search: boolean;
  pattern: RegExp;
};

/**
 * Exported for tests. Strong search cues only — bare weak tokens (`version`,
 * `release`, `price`, `job`) live in `WEAK_CURRENCY_SEARCH_RULES` and require a
 * currency cue after conceptual/coding suppressors run.
 */
export const WEB_SEARCH_RULES: readonly WebSearchRule[] = [
  {
    reason: "explicit_request",
    search: true,
    pattern:
      /\b(?:search(?:\s+the)?\s+web|look\s+up\s+online|find\s+online|google|browse\s+(?:the\s+)?web|web\s+search|look\s+this\s+up|check\s+online|(?:coba\s+)?cari(?:\s+di)?\s+(?:web|online|internet)|(?:coba\s+)?cek(?:\s+di)?\s+(?:web|online|internet)|lihat\s+di\s+web|telusuri\s+web)\b/i,
  },
  {
    reason: "temporal_currency",
    search: true,
    pattern:
      /\b(?:latest|current|today|recent(?:ly)?|this\s+week|right\s+now|as\s+of|up[- ]to[- ]date|saat\s+ini|sekarang|hari\s+ini|terbaru|terkini|baru[- ]baru\s+ini|minggu\s+ini|update\s+terbaru|update\s+terkini)\b/i,
  },
  {
    reason: "news",
    search: true,
    pattern: /\b(?:news|headlines|breaking)\b/i,
  },
  {
    reason: "prices_markets",
    search: true,
    // Bare "price(s)" is weak — see WEAK_CURRENCY_SEARCH_RULES.
    pattern:
      /\b(?:stock(?:s)?|share\s+price|fx|forex|exchange\s+rate|crypto|bitcoin|ethereum|spot\s+price|market\s+price)\b/i,
  },
  {
    reason: "schedules",
    search: true,
    pattern: /\b(?:schedule|timetable|kickoff|kick-off|airs|airing|fixture)\b/i,
  },
  {
    reason: "releases_versions",
    search: true,
    // Bare "version" / "release" are weak — see WEAK_CURRENCY_SEARCH_RULES.
    pattern: /\b(?:changelog|what'?s\s+new\s+in|cve-\d+|cve\b)\b/i,
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
    // Bare "job(s)" is weak — see WEAK_CURRENCY_SEARCH_RULES.
    pattern: /\b(?:hiring|careers?\s+posting|job\s+posting|open\s+roles?)\b/i,
  },
  {
    reason: "public_info_stale",
    search: true,
    // Requires a currency cue elsewhere in the query (checked in decideWebSearch).
    pattern: /\b(?:who\s+owns|market\s+share|regulation|regulated\s+by)\b/i,
  },
] as const;

/**
 * Weak tokens that historically over-triggered on conceptual/coding asks, plus
 * Indonesian market topic cues (IHSG, saham, …) that must not search alone.
 * Only search when a currency cue is also present (and suppressors did not win).
 */
export const WEAK_CURRENCY_SEARCH_RULES: readonly WebSearchRule[] = [
  {
    reason: "prices_markets",
    search: true,
    pattern: /\b(?:price|prices)\b/i,
  },
  {
    reason: "prices_markets",
    search: true,
    // Indonesian market topic cues — never alone; need a currency cue (or explicit web intent).
    pattern:
      /\b(?:ihsg|idx|jci|bei|saham|harga\s+saham|pasar\s+saham|indeks\s+saham|indeks\s+pasar)\b/i,
  },
  {
    reason: "releases_versions",
    search: true,
    pattern: /\b(?:release|released|version)\b/i,
  },
  {
    reason: "jobs",
    search: true,
    pattern: /\b(?:job|jobs)\b/i,
  },
] as const;

const ROOM_SUFFICIENT_PATTERN =
  /\b(?:based\s+on\s+this\s+file|based\s+on\s+the\s+(?:attached|room)\s+file|in\s+this\s+room|from\s+(?:the\s+)?(?:attached|room)\s+file|using\s+(?:only\s+)?(?:this|the)\s+(?:file|attachment|room)|summarize\s+(?:this|the)\s+(?:file|attachment|document)|according\s+to\s+(?:this|the)\s+file)\b/i;

const CONCEPTUAL_PATTERN =
  /\b(?:explain|how\s+does|how\s+do|what\s+is|what\s+are|teach\s+me|why\s+(?:is|are|do|does)|concept\s+of|difference\s+between|jelaskan|apa\s+itu|bagaimana\s+cara|cara\s+kerja|ajarkan|mengapa|kenapa|perbedaan\s+antara)\b/i;

const PURE_WRITING_PATTERN =
  /\b(?:rewrite|rephrase|draft|edit|proofread|tone|make\s+(?:this|it)\s+(?:shorter|longer|clearer|more\s+formal|more\s+casual)|polish\s+(?:this|my))\b/i;

const GENERIC_CODING_PATTERN =
  /\b(?:bug|fix|refactor|implement|function|typescript|javascript|python|code\s+review|unit\s+test|compile\s+error|type\s+error)\b/i;

const CURRENCY_CUE_PATTERN =
  /\b(?:latest|current|today|recent(?:ly)?|this\s+week|right\s+now|as\s+of|up[- ]to[- ]date|saat\s+ini|sekarang|hari\s+ini|terbaru|terkini|baru[- ]baru\s+ini|minggu\s+ini|update\s+terbaru|update\s+terkini)\b/i;

/**
 * Indonesian / IDX market topic cues (same family as WEAK_CURRENCY_SEARCH_RULES).
 * Alone they must not search; with condition/direction intent they do (see below).
 */
const MARKET_TOPIC_PATTERN =
  /\b(?:ihsg|idx|jci|bei|saham|harga\s+saham|pasar\s+saham|indeks\s+saham|indeks\s+pasar)\b/i;

/**
 * Condition / direction / performance intent for live market asks that often omit
 * explicit freshness words ("hari ini") but still need web grounding.
 */
const MARKET_CONDITION_INTENT_PATTERN =
  /\b(?:kondisi|arah|analisa|analisis|anjlok|menguat|melemah|penutupan|closing|pergerakan|proyeksi|outlook|forecast|kinerja|performa|performance|how\s+(?:is|are)|where\s+is)\b/i;

export type DecideWebSearchOpts = {
  hasRoomFileContext?: boolean;
};

/**
 * Deterministic capability routing for web search. No LLM.
 * Empty/whitespace → no search. Room-only grounding can skip web when file context exists.
 * Strong search cues win first; market topic + condition/direction intent searches next
 * (before conceptual suppressors, so "IHSG anjlok kenapa?" still searches). Conceptual /
 * coding / writing suppressors then run before weak token rules (`version` / `release` /
 * `price` / `job` / bare IHSG), which require a currency cue.
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

  const hasCurrencyCue = CURRENCY_CUE_PATTERN.test(text);

  // Strong search rules (currency cues, news, markets, docs, …).
  for (const rule of WEB_SEARCH_RULES) {
    if (!rule.search || rule.reason === "explicit_request" || rule.reason === "public_info_stale") {
      continue;
    }
    if (rule.pattern.test(text)) {
      return { search: true, reason: rule.reason };
    }
  }

  // Market topic + condition/direction intent → search without a separate currency cue.
  // Runs before conceptual suppressors so "kenapa IHSG anjlok" still grounds on web.
  // Definitional asks ("apa itu IHSG?") lack condition intent and stay suppressed below.
  if (MARKET_TOPIC_PATTERN.test(text) && MARKET_CONDITION_INTENT_PATTERN.test(text)) {
    return { search: true, reason: "prices_markets" };
  }

  // Suppressors before weak bare-token rules so conceptual/coding asks do not search.
  if (PURE_WRITING_PATTERN.test(text)) {
    return { search: false, reason: "pure_writing" };
  }
  if (GENERIC_CODING_PATTERN.test(text) && !hasCurrencyCue) {
    return { search: false, reason: "generic_coding" };
  }
  if (CONCEPTUAL_PATTERN.test(text) && !hasCurrencyCue) {
    return { search: false, reason: "conceptual" };
  }

  // Weak tokens only with an explicit currency cue.
  if (hasCurrencyCue) {
    for (const rule of WEAK_CURRENCY_SEARCH_RULES) {
      if (rule.pattern.test(text)) {
        return { search: true, reason: rule.reason };
      }
    }
  }

  return { search: false, reason: "default_no_search" };
}

function matchRule(text: string, reason: WebRouteReason): WebRouteDecision | null {
  const rule = WEB_SEARCH_RULES.find((entry) => entry.reason === reason);
  if (!rule || !rule.pattern.test(text)) return null;
  return { search: rule.search, reason: rule.reason };
}
