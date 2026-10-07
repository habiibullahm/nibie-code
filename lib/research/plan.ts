import { z } from "zod";
import type { ChatProvider, ProviderMessage } from "@/lib/ai/provider";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { readOpenAiSse } from "@/lib/ai/sse";
import {
  RESEARCH_MAX_INITIAL_QUERIES,
  RESEARCH_MAX_SUBQUESTIONS,
  RESEARCH_PLAN_MAX_OUTPUT_CHARS,
  RESEARCH_PLAN_TIMEOUT_MS,
} from "@/lib/research/budgets";
import type { ResearchPlan } from "@/lib/research/types";

export type ResearchPlanFailureReason = "timeout" | "provider_failed" | "malformed_output" | "invalid_shape" | "aborted";

export class ResearchPlanError extends Error {
  constructor(public readonly reason: ResearchPlanFailureReason) {
    super("Deep Research plan could not be generated.");
    this.name = "ResearchPlanError";
  }
}

const rawPlanSchema = z.object({
  normalizedQuestion: z.string(),
  subquestions: z.array(z.string()).optional(),
  initialQueries: z.array(z.string()).optional(),
  timeSensitive: z.boolean().optional(),
  notes: z.string().optional(),
});

const PLANNER_INSTRUCTIONS = [
  "You are Nibie's Deep Research planner. Produce a bounded research plan for one user question.",
  "Output exactly one JSON object and nothing else (no markdown fences).",
  'Keys: "normalizedQuestion" (string), "subquestions" (string array ≤5), "initialQueries" (string array ≤8 web search queries), "timeSensitive" (boolean — true only when freshness of facts matters: news, prices, versions, current leadership, live market), "notes" (short string).',
  "Queries must be concrete search strings, not instructions. Prefer primary/official sources when the question implies them.",
  "Do not invent answers or URLs. Do not plan endless loops or browsing automation.",
].join("\n");

export function buildResearchPlanPrompt(question: string): ProviderMessage[] {
  return [
    { role: "system", content: PLANNER_INSTRUCTIONS },
    { role: "user", content: JSON.stringify({ question: question.trim() }) },
  ];
}

function stripFence(text: string) {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  return fenced ? fenced[1]!.trim() : text;
}

function cleanQuery(value: string): string | null {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length < 2 || trimmed.length > 240) return null;
  return trimmed;
}

/** Validate and hard-bound planner output. Never trusts unbounded model lists. */
export function parseAndBoundResearchPlan(raw: string, fallbackQuestion: string): ResearchPlan {
  const text = stripFence(sanitizeModelOutput(raw).text.trim());
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ResearchPlanError("malformed_output");
  }
  const parsed = rawPlanSchema.safeParse(value);
  if (!parsed.success) throw new ResearchPlanError("invalid_shape");

  const normalizedQuestion =
    cleanQuery(parsed.data.normalizedQuestion) ?? cleanQuery(fallbackQuestion) ?? fallbackQuestion.trim().slice(0, 240);

  const subquestions = (parsed.data.subquestions ?? [])
    .map(cleanQuery)
    .filter((q): q is string => Boolean(q))
    .slice(0, RESEARCH_MAX_SUBQUESTIONS);

  let initialQueries = (parsed.data.initialQueries ?? [])
    .map(cleanQuery)
    .filter((q): q is string => Boolean(q));

  // Deduplicate queries (case-insensitive).
  const seen = new Set<string>();
  initialQueries = initialQueries.filter((q) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, RESEARCH_MAX_INITIAL_QUERIES);

  if (!initialQueries.length) {
    initialQueries = [normalizedQuestion].slice(0, RESEARCH_MAX_INITIAL_QUERIES);
  }

  return {
    normalizedQuestion,
    subquestions,
    initialQueries,
    timeSensitive: parsed.data.timeSensitive === true,
    notes: (parsed.data.notes ?? "").trim().slice(0, 400),
  };
}

/** Fallback when the planner model fails — still bounded, never an open loop. */
export function fallbackResearchPlan(question: string): ResearchPlan {
  const normalizedQuestion = question.trim().slice(0, 240) || "research question";
  return {
    normalizedQuestion,
    subquestions: [normalizedQuestion].slice(0, RESEARCH_MAX_SUBQUESTIONS),
    initialQueries: [normalizedQuestion].slice(0, RESEARCH_MAX_INITIAL_QUERIES),
    timeSensitive: /\b(latest|current|today|202[4-9]|price|pricing|news|version|release|ceo|market)\b/i.test(question),
    notes: "planner_fallback",
  };
}

export async function generateResearchPlan(options: {
  provider: ChatProvider;
  mode: "Fast" | "Balanced" | "High";
  question: string;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<ResearchPlan> {
  if (options.signal.aborted) throw new ResearchPlanError("aborted");
  const aborter = new AbortController();
  const onAbort = () => aborter.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    aborter.abort();
  }, options.timeoutMs ?? RESEARCH_PLAN_TIMEOUT_MS);

  let output = "";
  try {
    const body = await options.provider.stream(
      options.mode,
      buildResearchPlanPrompt(options.question),
      aborter.signal,
    );
    for await (const item of readOpenAiSse(body, aborter.signal)) {
      if (item.type === "done") break;
      output += item.text;
      if (output.length > RESEARCH_PLAN_MAX_OUTPUT_CHARS) break;
    }
  } catch {
    if (options.signal.aborted || aborter.signal.aborted) {
      throw new ResearchPlanError(timedOut ? "timeout" : "aborted");
    }
    throw new ResearchPlanError("provider_failed");
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
    aborter.abort();
  }

  if (options.signal.aborted) throw new ResearchPlanError("aborted");
  return parseAndBoundResearchPlan(output, options.question);
}
