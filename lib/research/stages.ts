import type { ResearchProgressStage } from "@/lib/research/types";

export const RESEARCH_STAGE_LABELS: Record<ResearchProgressStage, string> = {
  planning: "Planning",
  searching: "Searching",
  reading: "Reading",
  synthesizing: "Synthesizing",
};

export function researchStageLabel(stage: ResearchProgressStage): string {
  return RESEARCH_STAGE_LABELS[stage];
}
