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
import { RESEARCH_GATHER_DEADLINE_MS, RESEARCH_MAX_ROUNDS } from "@/lib/research/budgets";
import { selectResearchFinalSources } from "@/lib/research/select";
import type {
  ResearchOrchestratorResult,
  ResearchProgressStage,
  ResearchRunMetrics,
} from "@/lib/research/types";
import { RESEARCH_USAGE_POLICY } from "@/lib/research/usage-policy";
import type { WebContextInput } from "@/lib/web/types";

function linkGatherDeadline(parent: AbortSignal, deadlineMs: number): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
  const local = new AbortController();
  let timedOut = false;
  const onParent = () => local.abort();
  if (parent.aborted) local.abort();
  else parent.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    local.abort();
  }, deadlineMs);
  return {
    signal: local.signal,
    timedOut: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}

function prefersPrimarySources(question: string, planNotes: string): boolean {
  return /\b(official|primary|documentation|docs)\b/i.test(`${question} ${planNotes}`);
}

export type RunDeepResearchOptions = {
  question: string;
  signal: AbortSignal;
  chatProvider: ChatProvider;
  /** Mode used for planner structured output (Fast preferred for cost). */
  planMode: "Fast" | "Balanced" | "High";
  searchProvider: WebSearchProvider | null;
  fetchPage?: typeof fetchWebPage;
  onProgress?: (stage: ResearchProgressStage) => void;
  /** Override gather wall-clock (tests). Defaults to RESEARCH_GATHER_DEADLINE_MS. */
  gatherDeadlineMs?: number;
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

  // Wall-clock gather deadline so plan+search+fetch fit under route maxDuration with room for synthesis.
  const gatherGate = linkGatherDeadline(opts.signal, opts.gatherDeadlineMs ?? RESEARCH_GATHER_DEADLINE_MS);
  const gatherSignal = gatherGate.signal;

  progress("planning");
  let modelCallCount = 0;
  let plan;
  try {
    plan = await generateResearchPlan({
      provider: opts.chatProvider,
      mode: opts.planMode,
      question: opts.question,
      signal: gatherSignal,
    });
    modelCallCount += 1;
  } catch (error) {
    if (opts.signal.aborted || gatherSignal.aborted || (error instanceof ResearchPlanError && error.reason === "aborted")) {
      gatherGate.clear();
      const timedOut = gatherGate.timedOut();
      // Gather deadline without evidence is a failed run, not user Stop.
      return {
        ...base(),
        status: timedOut ? "failed" : "interrupted",
        incompleteNotice: timedOut
          ? "Deep Research ran out of time while planning."
          : "Research was stopped during planning.",
        metrics: emptyMetrics({
          modelCallCount,
          durationMs: Date.now() - startedAt,
          incompleteReason: timedOut ? "gather_deadline" : undefined,
        }),
      };
    }
    // Planner failure → bounded fallback, never an uncontrolled loop.
    plan = fallbackResearchPlan(opts.question);
    modelCallCount += 1;
  }

  if (gatherSignal.aborted) {
    gatherGate.clear();
    const timedOut = gatherGate.timedOut();
    return {
      ...base(),
      status: timedOut ? "failed" : "interrupted",
      plan,
      incompleteNotice: timedOut
        ? "Deep Research ran out of time after planning."
        : "Research was stopped after planning.",
      metrics: emptyMetrics({
        modelCallCount,
        timeSensitive: plan.timeSensitive,
        durationMs: Date.now() - startedAt,
        incompleteReason: timedOut ? "gather_deadline" : undefined,
      }),
    };
  }

  const selectOpts = {
    timeSensitive: plan.timeSensitive,
    preferPrimary: prefersPrimarySources(opts.question, plan.notes),
  };

  progress("searching");
  const initial = await gatherResearchSources(plan.initialQueries, {
    signal: gatherSignal,
    provider: opts.searchProvider,
    fetchPage: opts.fetchPage,
    ...selectOpts,
  });

  if (gatherSignal.aborted) {
    gatherGate.clear();
    const timedOut = gatherGate.timedOut();
    const evidence = initial.sources.map((s) => extractEvidenceChunk(s));
    const web = evidenceToWebContext(evidence);
    const status = !timedOut
      ? "interrupted"
      : evidence.length > 0 && web.length > 0
        ? "incomplete"
        : "failed";
    return {
      ...base(),
      status,
      plan,
      evidence,
      web,
      contradictions: detectContradictions(evidence),
      incompleteNotice: timedOut
        ? "Deep Research ran out of time while searching."
        : "Research was stopped while searching.",
      metrics: emptyMetrics({
        modelCallCount,
        searchQueryCount: initial.searchQueryCount,
        searchResultCount: initial.searchResultCount,
        pagesFetched: initial.pagesFetched,
        pagesFailed: initial.pagesFailed,
        candidateUrlCount: initial.candidateUrlCount,
        evidenceCount: evidence.length,
        timeSensitive: plan.timeSensitive,
        durationMs: Date.now() - startedAt,
        incompleteReason: timedOut ? "gather_deadline" : undefined,
      }),
    };
  }

  progress("reading");
  let gathered = initial;
  let followUpUsed = false;
  let rounds = 1;

  const initialEvidence = gathered.sources.map((s) => extractEvidenceChunk(s));
  const gap = detectResearchGaps(plan, initialEvidence);

  if (gap.needsFollowUp && gap.followUpQueries.length && !gatherSignal.aborted && rounds < RESEARCH_MAX_ROUNDS) {
    followUpUsed = true;
    rounds += 1;
    progress("searching");
    const followUp = await gatherResearchSources(gap.followUpQueries, {
      signal: gatherSignal,
      provider: opts.searchProvider,
      fetchPage: opts.fetchPage,
      ...selectOpts,
    });
    // Merge sources; final select again via combining then re-extract.
    const mergedSources = selectMerged(gathered.sources, followUp.sources, selectOpts);
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

  gatherGate.clear();

  if (opts.signal.aborted || gatherGate.timedOut()) {
    const evidence = gathered.sources.map((s) => extractEvidenceChunk(s));
    const web = evidenceToWebContext(evidence);
    const timedOut = gatherGate.timedOut();
    // Gather deadline with evidence → incomplete (synthesize); without → failed. User abort → interrupted.
    const status = !timedOut
      ? "interrupted"
      : evidence.length > 0 && web.length > 0
        ? "incomplete"
        : "failed";
    return {
      ...base(),
      status,
      plan,
      evidence,
      web,
      contradictions: detectContradictions(evidence),
      incompleteNotice: timedOut
        ? "Deep Research ran out of time before synthesis."
        : "Research was stopped before synthesis.",
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
        incompleteReason: timedOut ? "gather_deadline" : undefined,
      }),
    };
  }

  const evidence = gathered.sources.map((s) => extractEvidenceChunk(s));
  const contradictions = detectContradictions(evidence);

  // Empty collection is a hard failure — never synthesize or charge as completed research.
  if (evidence.length === 0) {
    return {
      ...base(),
      status: "failed",
      plan,
      evidence: [],
      web: [],
      contradictions: [],
      incompleteNotice: "Deep Research could not collect usable sources. Please try again later or switch to Normal.",
      metrics: emptyMetrics({
        modelCallCount,
        searchQueryCount: gathered.searchQueryCount,
        searchResultCount: gathered.searchResultCount,
        pagesFetched: gathered.pagesFetched,
        pagesFailed: gathered.pagesFailed,
        candidateUrlCount: gathered.candidateUrlCount,
        evidenceCount: 0,
        followUpUsed,
        timeSensitive: plan.timeSensitive,
        durationMs: Date.now() - startedAt,
        incompleteReason: gathered.failureCategory ?? "empty",
      }),
    };
  }

  progress("synthesizing");
  const incompleteNotice =
    gathered.pagesFailed > 0 && evidence.length < 3
      ? "Some sources could not be read; evidence is partial."
      : null;

  return {
    status: incompleteNotice ? "incomplete" : "complete",
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
      incompleteReason: incompleteNotice ? "partial" : undefined,
    },
  };
}

function selectMerged(
  a: WebContextInput[],
  b: WebContextInput[],
  opts: { timeSensitive?: boolean; preferPrimary?: boolean } = {},
) {
  return selectResearchFinalSources([...a, ...b], undefined, opts);
}
