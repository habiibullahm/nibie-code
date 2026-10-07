import { citationInstructionFor } from "@/lib/citations/prepare";
import type { SourceReference } from "@/lib/citations/types";
import type { ResearchContradiction, ResearchPlan } from "@/lib/research/types";

/**
 * Extra synthesis guidance for Deep Research — structure adapts to the question,
 * not a fixed giant template. Citations still use SourceReference handles only.
 */
export function researchSynthesisInstruction(options: {
  plan: ResearchPlan;
  sources: readonly SourceReference[];
  contradictions: readonly ResearchContradiction[];
  incompleteNotice: string | null;
}): string {
  const lines: string[] = [
    "Deep Research mode: answer from the gathered web evidence only for current/public claims.",
    "Structure the reply to fit the question (for example: brief conclusion, key findings, tradeoffs, recommendation, uncertainties, and citations). Do not force every section if irrelevant.",
    "Cite supporting claims with exact cite_as handles. Never invent handles, URLs, titles, or source numbers.",
    "When sources disagree on pricing, regulation, benchmarks, market figures, or capabilities, surface the disagreement and cite each side.",
  ];

  if (options.plan.timeSensitive) {
    lines.push("This question is time-sensitive: prefer fresher sources and say when evidence may be stale.");
  } else {
    lines.push("This question is not primarily time-sensitive: do not over-weight recency for timeless concepts.");
  }

  if (options.contradictions.length) {
    lines.push(
      `Possible material disagreements to check: ${options.contradictions.map((c) => c.topic).join(", ")}.`,
    );
  }

  if (options.incompleteNotice) {
    lines.push(
      `Evidence collection was incomplete (${options.incompleteNotice}). Do not claim research was complete. State uncertainties clearly.`,
    );
  }

  if (!options.sources.length) {
    lines.push(
      "No verified web sources were gathered. Do not fabricate a completed multi-source research report. Explain that research could not collect sources and offer only careful general guidance without fake citations.",
    );
  } else {
    const cite = citationInstructionFor(options.sources);
    if (cite) lines.push(cite);
  }

  return lines.join(" ");
}
