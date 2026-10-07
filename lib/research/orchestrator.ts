import type { ChatProvider } from "@/lib/ai/provider";
import type { WebSearchProvider } from "@/lib/web/provider";
import { fetchWebPage } from "@/lib/web/fetch-page";
import {
  detectContradictions,
  evidenceToWebContext,
  extractEvidenceChunk,
} from "@/lib/research/evidence";
import { detectResearchGaps } from "@/lib/research/gap";
import { gatherResearchSources } from "@/lib/research/gather";
import {
  fallbackResearchPlan,
  generateResearchPlan,
  ResearchPlanError,
} from "@/lib/research/plan";
import { selectResearchFinalSources } from "@/lib/research/select";
import type {
  ResearchOrchestratorResult,
  ResearchProgressStage,
  ResearchRunMetrics,
} from "@/lib/research/types";
import { RESEARCH_USAGE_POLICY } from "@/lib/research/usage-policy";
import type { WebContextInput } from "@/lib/web/types";

export type RunDeepResearchOptions = {
  question: string;
  signal: AbortSignal;
  chatProvider: ChatProvider;
  /** Mode used for planner structured output (Fast preferred for cost). */
  planMode: "Fast" | "Balanced" | "High";
  searchProvider: WebSearchProvider | null;
  fetchPage?: typeof fetchWebPage;
  onProgress?: (stage: ResearchProgressStage) => void;
};

function emptyMetrics(partial: Partial<ResearchRunMetrics> = {}): ResearchRunMetrics {
  return {
    modelCallCount: 0,
    searchQueryCount: 0,
    searchResultCount: 0,
    pagesFetched: 0,
    pagesFailed: 0,
    candidateUrlCount: 0,
    evidenceCount: 0,
    followUpUsed: false,
    durationMs: 0,
    timeSensitive: false,
    ...partial,
  };
}

/**
 * Bounded Deep Research orchestrator:
 * normalize/plan → search → fetch → evidence → gap → ≤1 follow-up → ready for cited synthesis.
 * Never an open-ended agent loop. Cancellation via AbortSignal.
 */
export async function runDeepResearch(
  opts: RunDeepResearchOptions,
): Promise<ResearchOrchestratorResult> {
  const startedAt = Date.now();
  const progress = (stage: ResearchProgressStage) => {
    try {
      opts.onProgress?.(stage);
    } catch {
      /* progress must never break research */
    }
  };

  const base = (): ResearchOrchestratorResult => ({
    status: "failed",
    plan: null,
    evidence: [],
    web: [],
    contradictions: [],
    metrics: emptyMetrics({ durationMs: Date.now() - startedAt }),
    incompleteNotice: null,
    usagePolicy: RESEARCH_USAGE_POLICY,
  });

  if (opts.signal.aborted) {
    return {
      ...base(),
      status: "interrupted",
      incompleteNotice: "Research was stopped before planning finished.",
    };
  }

  if (!opts.searchProvider) {
    return {
      ...base(),
      status: "failed",
      incompleteNotice: "Web search is not configured, so Deep Research could not gather sources.",
      metrics: emptyMetrics({
        durationMs: Date.now() - startedAt,
        incompleteReason: "provider_unconfigured",
      }),
    };
  }

  progress("planning");
  let modelCallCount = 0;
  let plan;
  try {
    plan = await generateResearchPlan({
      provider: opts.chatProvider,
      mode: opts.planMode,
      question: opts.question,
      signal: opts.signal,
    });
    modelCallCount += 1;
  } catch (error) {
    if (opts.signal.aborted || (error instanceof ResearchPlanError && error.reason === "aborted")) {
      return {
        ...base(),
        status: "interrupted",
        incompleteNotice: "Research was stopped during planning.",
        metrics: emptyMetrics({ modelCallCount, durationMs: Date.now() - startedAt }),
      };
    }
    // Planner failure → bounded fallback, never an uncontrolled loop.
    plan = fallbackResearchPlan(opts.question);
    modelCallCount += 1;
  }

  if (opts.signal.aborted) {
    return {
      ...base(),
      status: "interrupted",
      plan,
      incompleteNotice: "Research was stopped after planning.",
      metrics: emptyMetrics({
        modelCallCount,
        timeSensitive: plan.timeSensitive,
        durationMs: Date.now() - startedAt,
      }),
    };
  }

  progress("searching");
  const initial = await gatherResearchSources(plan.initialQueries, {
    signal: opts.signal,
    provider: opts.searchProvider,
    fetchPage: opts.fetchPage,
  });

  if (opts.signal.aborted) {
    return {
      ...base(),
      status: "interrupted",
      plan,
      incompleteNotice: "Research was stopped while searching.",
      metrics: emptyMetrics({
        modelCallCount,
        searchQueryCount: initial.searchQueryCount,
        searchResultCount: initial.searchResultCount,
        pagesFetched: initial.pagesFetched,
        pagesFailed: initial.pagesFailed,
        candidateUrlCount: initial.candidateUrlCount,
        timeSensitive: plan.timeSensitive,
        durationMs: Date.now() - startedAt,
      }),
    };
  }

  progress("reading");
  let gathered = initial;
  let followUpUsed = false;

  const initialEvidence = gathered.sources.map((s) => extractEvidenceChunk(s));
  const gap = detectResearchGaps(plan, initialEvidence);

  if (gap.needsFollowUp && gap.followUpQueries.length && !opts.signal.aborted) {
    followUpUsed = true;
    progress("searching");
    const followUp = await gatherResearchSources(gap.followUpQueries, {
      signal: opts.signal,
      provider: opts.searchProvider,
      fetchPage: opts.fetchPage,
    });
    // Merge sources; final select again via combining then re-extract.
    const mergedSources = selectMerged(gathered.sources, followUp.sources);
    gathered = {
      sources: mergedSources,
      searchQueryCount: gathered.searchQueryCount + followUp.searchQueryCount,
      searchResultCount: gathered.searchResultCount + followUp.searchResultCount,
      candidateUrlCount: Math.max(gathered.candidateUrlCount, followUp.candidateUrlCount),
      pagesFetched: gathered.pagesFetched + followUp.pagesFetched,
      pagesFailed: gathered.pagesFailed + followUp.pagesFailed,
      failureCategory: followUp.failureCategory ?? gathered.failureCategory,
    };
  }

  if (opts.signal.aborted) {
    const evidence = gathered.sources.map((s) => extractEvidenceChunk(s));
    return {
      ...base(),
      status: "interrupted",
      plan,
      evidence,
      web: evidenceToWebContext(evidence),
      contradictions: detectContradictions(evidence),
      incompleteNotice: "Research was stopped before synthesis.",
      metrics: emptyMetrics({
        modelCallCount,
        searchQueryCount: gathered.searchQueryCount,
        searchResultCount: gathered.searchResultCount,
        pagesFetched: gathered.pagesFetched,
        pagesFailed: gathered.pagesFailed,
        candidateUrlCount: gathered.candidateUrlCount,
        evidenceCount: evidence.length,
        followUpUsed,
        timeSensitive: plan.timeSensitive,
        durationMs: Date.now() - startedAt,
      }),
    };
  }

  progress("synthesizing");
  const evidence = gathered.sources.map((s) => extractEvidenceChunk(s));
  const contradictions = detectContradictions(evidence);
  const incompleteNotice =
    evidence.length === 0
      ? "Deep Research could not collect usable sources. The answer may be incomplete."
      : gathered.pagesFailed > 0 && evidence.length < 3
        ? "Some sources could not be read; evidence is partial."
        : null;

  const status =
    evidence.length === 0
      ? "incomplete"
      : incompleteNotice
        ? "incomplete"
        : "complete";

  return {
    status,
    plan,
    evidence,
    web: evidenceToWebContext(evidence),
    contradictions,
    incompleteNotice,
    usagePolicy: RESEARCH_USAGE_POLICY,
    metrics: {
      modelCallCount,
      searchQueryCount: gathered.searchQueryCount,
      searchResultCount: gathered.searchResultCount,
      pagesFetched: gathered.pagesFetched,
      pagesFailed: gathered.pagesFailed,
      candidateUrlCount: gathered.candidateUrlCount,
      evidenceCount: evidence.length,
      followUpUsed,
      durationMs: Date.now() - startedAt,
      timeSensitive: plan.timeSensitive,
      incompleteReason: evidence.length === 0 ? (gathered.failureCategory ?? "empty") : incompleteNotice ? "partial" : undefined,
    },
  };
}

function selectMerged(a: WebContextInput[], b: WebContextInput[]) {
  return selectResearchFinalSources([...a, ...b]);
}
