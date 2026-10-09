import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { chatProvider, configuredModelLabel } from "@/lib/ai/provider";
import { createReasoningStreamFilter, sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { ProviderStreamError, readOpenAiSse } from "@/lib/ai/sse";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { requestIdFrom } from "@/lib/observability/request-id";
import { finalizeGenerationSpend, releaseUsageHold, reserveUsageBeforeGeneration, startWeeklyUsage } from "@/lib/usage/guards";
import { estimateUsageFromText, withCostEstimate, type ProviderTokenUsage } from "@/lib/usage/provider-usage";
import { parseWorkbenchSuggestion, workbenchReviseMessages } from "@/lib/workbench/prompt";
import { workbenchContentLimit } from "@/lib/workbench/types";
import { parseWorkbenchInstruction, validateWorkbenchId } from "@/lib/workbench/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const encoder = new TextEncoder();
const safeError = "Nibie couldn't improve that document. Please try again.";
/** Shown when migration 0027 (revision + workbench_revision_runs) is not on the shared DB yet. */
const schemaPendingError = "Workbench AI isn't available on this environment yet. An owner needs to apply migration 0027 (add allow-shared-db-migrate on the PR, or run Preview App DB Migration).";
const mode = "Balanced" as const;

function event(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose a valid document." }, { status: 400 });
  }
  const documentId = validateWorkbenchId((body as { documentId?: unknown } | null)?.documentId);
  const expectedRevision = Number((body as { expectedRevision?: unknown } | null)?.expectedRevision);
  const instruction = parseWorkbenchInstruction((body as { instruction?: unknown } | null)?.instruction);
  if (!documentId.success || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return NextResponse.json({ error: "Choose a valid document." }, { status: 400 });
  }
  if ("error" in instruction) return NextResponse.json({ error: instruction.error }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const { data: document, error: documentError } = await supabase
    .from("workbench_documents")
    .select("id,title,content,revision")
    .eq("id", documentId.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (documentError) {
    if (schemaUnavailable(documentError)) {
      logWarn("workbench.revise.schema_pending", { requestId, code: operationalCodes.requestFailed });
      return NextResponse.json({ error: schemaPendingError, schemaPending: true }, { status: 503 });
    }
    return NextResponse.json({ error: safeError }, { status: 503 });
  }
  if (!document) return NextResponse.json({ error: "That document is no longer available." }, { status: 404 });
  if (document.revision !== expectedRevision) {
    return NextResponse.json({ error: "This document changed elsewhere. Reload before generating.", conflict: true }, { status: 409 });
  }

  const runId = randomUUID();
  const { error: insertError } = await supabase.from("workbench_revision_runs").insert({
    id: runId,
    user_id: user.id,
    document_id: document.id,
    status: "generating",
    instruction: instruction.data,
    base_revision: expectedRevision,
    base_title: document.title,
    base_content: document.content,
  });
  if (insertError) {
    if (schemaUnavailable(insertError)) {
      logWarn("workbench.revise.schema_pending", { requestId, code: operationalCodes.requestFailed });
      return NextResponse.json({ error: schemaPendingError, schemaPending: true }, { status: 503 });
    }
    logError("workbench.revise.run_create_failed", { requestId, code: operationalCodes.requestFailed });
    return NextResponse.json({ error: safeError }, { status: 503 });
  }

  const gate = await reserveUsageBeforeGeneration({
    supabase,
    userId: user.id,
    generationId: runId,
    mode,
    usageKind: "chat",
    requestId,
  });
  if (!gate.ok) {
    await supabase.from("workbench_revision_runs").update({
      status: "failed",
      error: gate.error,
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("user_id", user.id);
    await gate.release();
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const aborter = new AbortController();
  const onAbort = () => aborter.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let released = false;
      let started = false;
      let providerUsage: ProviderTokenUsage | null = null;
      const release = async () => {
        if (released) return;
        released = true;
        await releaseUsageHold({ supabase, userId: user.id, generationId: runId, requestId, logicalMode: mode });
      };
      const failRun = async (message: string, status: "failed" | "cancelled" = "failed") => {
        await supabase.from("workbench_revision_runs").update({
          status,
          error: message,
          completed_at: new Date().toISOString(),
        }).eq("id", runId).eq("user_id", user.id).eq("status", "generating");
      };
      try {
        controller.enqueue(encoder.encode(event("start", { runId, expectedRevision, model: configuredModelLabel(mode) })));
        controller.enqueue(encoder.encode(event("status", { status: "Generating suggestion…" })));

        const prompt = workbenchReviseMessages({
          instruction: instruction.data,
          document: { title: document.title, content: document.content },
        });
        const promptChars = prompt.reduce((sum, message) => sum + message.content.length, 0);
        let responseStream: ReadableStream<Uint8Array>;
        try {
          responseStream = await chatProvider.stream(mode, prompt, aborter.signal);
        } catch {
          if (aborter.signal.aborted || request.signal.aborted) {
            await failRun("Suggestion cancelled.", "cancelled");
            await release();
            controller.enqueue(encoder.encode(event("cancelled", { error: "Suggestion cancelled." })));
            return;
          }
          logWarn("workbench.revise.provider_failed", { requestId, logicalMode: mode });
          await failRun(safeError);
          await release();
          controller.enqueue(encoder.encode(event("error", { error: safeError })));
          return;
        }

        started = await startWeeklyUsage({ supabase, generationId: runId, requestId, logicalMode: mode });
        if (!started) {
          await failRun(safeError);
          await release();
          controller.enqueue(encoder.encode(event("error", { error: safeError })));
          return;
        }

        const reasoningFilter = createReasoningStreamFilter();
        let raw = "";
        try {
          for await (const part of readOpenAiSse(responseStream, aborter.signal)) {
            if (part.type === "delta") {
              const visible = reasoningFilter.push(part.text);
              if (!visible) continue;
              raw += visible;
              if (raw.length > workbenchContentLimit + 2_000) throw new Error("Suggestion too large.");
              // Deltas are informational only; Apply stays disabled until complete.
              controller.enqueue(encoder.encode(event("delta", { text: visible })));
              continue;
            }
            if (part.type === "done") {
              const trailing = reasoningFilter.finish();
              if (trailing) {
                raw += trailing;
                controller.enqueue(encoder.encode(event("delta", { text: trailing })));
              }
              providerUsage = part.usage ?? null;
            }
          }
        } catch (error) {
          if (aborter.signal.aborted || request.signal.aborted) {
            await failRun("Suggestion cancelled.", "cancelled");
            // Started generations keep spend; release only unused hold path is not used after start.
            controller.enqueue(encoder.encode(event("cancelled", { error: "Suggestion cancelled." })));
            return;
          }
          const message = error instanceof ProviderStreamError ? error.message : safeError;
          logWarn("workbench.revise.stream_failed", { requestId, logicalMode: mode });
          await failRun(message);
          controller.enqueue(encoder.encode(event("error", { error: message })));
          return;
        }

        const sanitized = sanitizeModelOutput(raw).text;
        const suggestion = parseWorkbenchSuggestion(sanitized, document.title);
        if (!suggestion) {
          await failRun("The suggestion was empty or too large.");
          controller.enqueue(encoder.encode(event("error", { error: "The suggestion was empty or too large." })));
          return;
        }

        const { error: completeError } = await supabase.from("workbench_revision_runs").update({
          status: "complete",
          proposed_title: suggestion.title,
          proposed_content: suggestion.content,
          completed_at: new Date().toISOString(),
        }).eq("id", runId).eq("user_id", user.id).eq("status", "generating");
        if (completeError) {
          await failRun(safeError);
          controller.enqueue(encoder.encode(event("error", { error: safeError })));
          return;
        }

        const usage = withCostEstimate(mode, providerUsage ?? estimateUsageFromText({
          promptChars,
          outputChars: suggestion.content.length,
        }));
        await finalizeGenerationSpend({
          supabase,
          userId: user.id,
          generationId: runId,
          actualMicros: usage.estimatedUsdMicros,
          requestId,
        });
        logInfo("workbench.revise.complete", { requestId, logicalMode: mode, generationId: runId });
        controller.enqueue(encoder.encode(event("complete", {
          runId,
          expectedRevision,
          suggestion,
        })));
      } catch {
        logError("workbench.revise.failed", { requestId, code: operationalCodes.requestFailed });
        try {
          await supabase.from("workbench_revision_runs").update({
            status: request.signal.aborted ? "cancelled" : "failed",
            error: safeError,
            completed_at: new Date().toISOString(),
          }).eq("id", runId).eq("user_id", user.id).eq("status", "generating");
        } catch {
          // ignore secondary failure
        }
        if (!started) await release();
        try {
          controller.enqueue(encoder.encode(event(request.signal.aborted ? "cancelled" : "error", {
            error: request.signal.aborted ? "Suggestion cancelled." : safeError,
          })));
        } catch {
          // stream may already be closed
        }
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try { controller.close(); } catch { /* closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-request-id": requestId,
    },
  });
}
