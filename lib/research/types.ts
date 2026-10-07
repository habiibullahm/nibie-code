import type { WebContextInput } from "@/lib/web/types";

/** Lightweight UI stages — never chain-of-thought. */
export type ResearchProgressStage = "planning" | "searching" | "reading" | "synthesizing";

export type ResearchRunStatus =
  | "running"
  | "complete"
  | "interrupted"
  | "failed"
  | "incomplete";

export type ResearchPlan = {
  normalizedQuestion: string;
  subquestions: string[];
  initialQueries: string[];
  timeSensitive: boolean;
  notes: string;
};

export type ResearchEvidenceChunk = {
  url: string;
  title: string;
  domain: string;
  publishedAt?: string | null;
  text: string;
  retrieval: WebContextInput["retrieval"];
};

export type ResearchContradiction = {
  topic: string;
  summary: string;
};

export type ResearchUsagePolicy = {
  /** Stable id for the temporary metering policy. */
  id: "temporary_undercount_v1";
  /** Human-readable honesty note for docs/logs (never secrets). */
  summary: string;
};

export type ResearchRunMetrics = {
  modelCallCount: number;
  searchQueryCount: number;
  searchResultCount: number;
  pagesFetched: number;
  pagesFailed: number;
  candidateUrlCount: number;
  evidenceCount: number;
  followUpUsed: boolean;
  durationMs: number;
  timeSensitive: boolean;
  incompleteReason?: string;
};

export type ResearchOrchestratorResult = {
  status: ResearchRunStatus;
  plan: ResearchPlan | null;
  evidence: ResearchEvidenceChunk[];
  /** Web context rows for Citations V1 attach (bounded evidence text). */
  web: WebContextInput[];
  contradictions: ResearchContradiction[];
  metrics: ResearchRunMetrics;
  /** User-visible incomplete explanation when collection failed partially. */
  incompleteNotice: string | null;
  usagePolicy: ResearchUsagePolicy;
};

export type ResearchProgressEvent = {
  stage: ResearchProgressStage;
};

/** Client-safe research metadata persisted with an assistant message. */
export type MessageResearchView = {
  status: string;
  followUpUsed: boolean;
  searchQueryCount: number;
  pagesFetched: number;
  evidenceCount: number;
  durationMs: number;
  usagePolicy: string;
};
