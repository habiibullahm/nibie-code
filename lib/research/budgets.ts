/** Deep Research V1 hard budgets — starting values tuned for latency/cost. */

export const RESEARCH_MAX_SUBQUESTIONS = 5;
export const RESEARCH_MAX_INITIAL_QUERIES = 8;
export const RESEARCH_MAX_FOLLOWUP_QUERIES = 4;
/** Initial gather + at most one follow-up round. */
export const RESEARCH_MAX_ROUNDS = 2;

export const RESEARCH_RESULTS_PER_QUERY = 5;
export const RESEARCH_CANDIDATE_URLS_MAX = 30;
export const RESEARCH_FETCH_PAGES_MAX = 12;
export const RESEARCH_FINAL_CITED_MAX = 10;

/** Bounded evidence chars per source before synthesis (not whole pages). */
export const RESEARCH_EVIDENCE_CHARS_MAX = 1_800;
/** Soft domain diversity: prefer not more than this many pages from one domain. */
export const RESEARCH_MAX_PAGES_PER_DOMAIN = 2;

export { RESEARCH_WEB_TOKEN_CAP } from "@/lib/context/token-budget";

export const RESEARCH_PLAN_TIMEOUT_MS = 45_000;
export const RESEARCH_PLAN_MAX_OUTPUT_CHARS = 8_000;
