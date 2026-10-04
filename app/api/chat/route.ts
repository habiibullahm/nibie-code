import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { validateConversationId, validateMessage } from "@/lib/chat/validation";
import { resolveMode } from "@/lib/chat/models";
import { modelChoiceInputSchema, normalizeSavedMode } from "@/lib/chat/legacy-mode";
import { chatProvider } from "@/lib/ai/provider";
import { toProviderMessages } from "@/lib/ai/provider-messages";
import { contextCapabilitiesFor, getModelOptions, providerFor } from "@/lib/ai/registry";
import { createReasoningStreamFilter, sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { ProviderStreamError, readOpenAiSse } from "@/lib/ai/sse";
import { buildContext } from "@/lib/context/build-context";
import { CONTEXT_POLICY_VERSION } from "@/lib/context/context-policy";
import type { FileContextInput } from "@/lib/context/context-types";
import type { RoomContextInput } from "@/lib/context/room-context";
import { parseSelectedFileIds } from "@/lib/files/inspect";
import { MAX_FILES_PER_MESSAGE } from "@/lib/files/limits";
import { roomContextFromRows, type PinContextRow, type RoomBriefRow } from "@/lib/rooms/map";
import { loadOwnerPreferences } from "@/lib/preferences/store";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { requestIdFrom } from "@/lib/observability/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const encoder = new TextEncoder();
const safeError = "Nibie couldn't complete that response. Please try again.";
function event(type: string, data: unknown) { return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; }

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try { return await respond(request, requestId, Date.now()); }
  catch {
    logError("chat.response.failed", { requestId, stage: "request", code: operationalCodes.requestFailed });
    return NextResponse.json({ error: safeError }, { status: 503 });
  }
}

async function respond(request: Request, requestId: string, requestStartedAt: number) {
  const supabase = await createSupabaseServerClient();
  // The session comes from the verified access token (no Auth round trip); row-level security still scopes every query below to its owner.
  // A missing session does not emit chat.response.started. Operators treat that absence as an auth or save-path miss.
  if (!await getAuthenticatedUser(supabase)) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return NextResponse.json({ error: "A JSON request is required." }, { status: 415 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const value = body as { conversationId?: unknown; userMessageId?: unknown; regenerate?: unknown; model?: unknown; fileIds?: unknown };
  const parsedId = validateConversationId(value?.conversationId);
  const parsedMessageId = validateConversationId(value?.userMessageId);
  const selectedFiles = parseSelectedFileIds(value?.fileIds, MAX_FILES_PER_MESSAGE);
  // The client may name a mode from a fixed vocabulary; it is never a provider model id. Reasoning is server-side routing config,
  // so a stale client's `reasoning` field is simply ignored.
  const requestedModel = value?.model === undefined ? undefined : modelChoiceInputSchema.safeParse(value.model);
  if (!selectedFiles.ok || !parsedId.success || !parsedMessageId.success || (value.regenerate !== undefined && typeof value.regenerate !== "boolean") || requestedModel?.success === false) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const regenerate = value.regenerate === true;
  // Only modes that are configured on the server can be used, whether the client asked for one or the conversation has one saved.
  const { models: availableModels } = getModelOptions();
  const availableModes = availableModels.map((option) => option.id);
  if (requestedModel && requestedModel.data !== "Auto" && !availableModes.includes(requestedModel.data)) return NextResponse.json({ error: "That model isn't available." }, { status: 400 });

  // The conversation, the user message and the recent context only depend on the ids in the request, so they are read together
  // (RLS hides other owners' rows from all three); the message context is trimmed to this message below.
  // Preferences are soft personalization. A failed read uses safe defaults and does not block this authenticated request.
  const [{ data: loadedConversation, error: loadedConversationError }, { data: userMessage, error: messageError }, { data: recent, error: readError }, preferenceState] = await Promise.all([
    supabase.from("conversations").select("id,selected_model,room_id").eq("id", parsedId.data).maybeSingle(),
    supabase.from("messages").select("id,position,content").eq("id", parsedMessageId.data).eq("conversation_id", parsedId.data).eq("role", "user").eq("status", "complete").maybeSingle(),
    supabase.from("messages").select("role,content,status,position").eq("conversation_id", parsedId.data).eq("status", "complete").order("position", { ascending: false }).limit(34),
    loadOwnerPreferences(supabase),
  ]);
  if (preferenceState.error) logError("preferences.read.failed", { requestId, code: operationalCodes.preferenceReadFailed });
  let conversation = loadedConversation;
  let conversationError = loadedConversationError;
  if (schemaUnavailable(conversationError)) {
    const legacy = await supabase.from("conversations").select("id,selected_model").eq("id", parsedId.data).maybeSingle();
    conversationError = legacy.error;
    conversation = legacy.data ? { ...(legacy.data as unknown as { id: string; selected_model: string }), room_id: null } : null;
  }
  if (conversationError) return NextResponse.json({ error: safeError }, { status: 503 });
  if (!conversation) return NextResponse.json({ error: "Conversation unavailable." }, { status: 404 });
  let room: RoomContextInput | null = null;
  if (conversation.room_id) {
    const [{ data: roomRow, error: roomError }, { data: briefRow, error: briefError }, { data: pinRows, error: pinError }] = await Promise.all([
      supabase.from("rooms").select("name,instructions").eq("id", conversation.room_id).maybeSingle(),
      supabase.from("room_briefs").select("goal,current_focus,important_decisions,open_questions,next_step").eq("room_id", conversation.room_id).maybeSingle(),
      supabase.from("pins").select("id,title,content,updated_at").eq("room_id", conversation.room_id).order("updated_at", { ascending: false }).order("id", { ascending: true }),
    ]);
    if (roomError || briefError || pinError) return NextResponse.json({ error: safeError }, { status: 503 });
    room = roomContextFromRows(roomRow, briefRow as RoomBriefRow | null, pinRows as PinContextRow[] | null);
  }
  let files: FileContextInput[] | undefined;
  if (selectedFiles.ids.length) {
    if (!conversation.room_id) return NextResponse.json({ error: "Choose a file from this thread's room." }, { status: 400 });
    const { data: fileRows, error: fileError } = await supabase.from("room_files").select("id,original_name,extracted_text").eq("room_id", conversation.room_id).in("id", selectedFiles.ids);
    if (fileError) return NextResponse.json({ error: safeError }, { status: 503 });
    const byId = new Map((fileRows ?? []).map((row) => [row.id, row]));
    if (selectedFiles.ids.some((id) => !byId.has(id))) return NextResponse.json({ error: "That file isn't available in this room." }, { status: 400 });
    files = selectedFiles.ids.map((id) => {
      const row = byId.get(id)!;
      return { name: row.original_name, text: row.extracted_text };
    });
  }
  const mode = requestedModel?.data && requestedModel.data !== "Auto" ? requestedModel.data : resolveMode(normalizeSavedMode(conversation.selected_model), availableModes);
  if (!mode) return NextResponse.json({ error: safeError }, { status: 503 });
  if (messageError) return NextResponse.json({ error: safeError }, { status: 503 });
  if (!userMessage) return NextResponse.json({ error: "Message unavailable." }, { status: 404 });
  if (!validateMessage(userMessage.content).success) return NextResponse.json({ error: "Invalid saved message." }, { status: 400 });
  const rows = recent?.filter((row) => row.position <= userMessage.position && (row.role === "user" || row.role === "assistant") && row.status === "complete").slice(0, 32);
  if (readError || !rows?.length) return NextResponse.json({ error: safeError }, { status: 503 });
  const { data: assistant, error: claimError } = await supabase.rpc(regenerate ? "regenerate_assistant_message" : "claim_assistant_message", {
    p_conversation_id: conversation.id, p_user_message_id: parsedMessageId.data,
  }).single<{ id: string; position: number; content: string; status: string; replayed: boolean }>();
  if (claimError || !assistant) {
    const status = claimError?.code === "PT404" ? 404 : claimError?.code === "PT409" || claimError?.code === "23505" ? 409 : 503;
    return NextResponse.json({ error: status === 409 ? "Another response is running or a newer message was saved. Refresh and try again." : safeError }, { status });
  }
  const headers = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" };
  if (assistant.replayed) {
    const text = sanitizeModelOutput(assistant.content).text;
    return new Response(event("start", { id: assistant.id, position: assistant.position }) + event("delta", { text }) + event("status", { status: "complete" }) + event("done", {}), { headers });
  }

  const responseStartedAt = Date.now();
  const durationMs = () => Date.now() - responseStartedAt;
  logInfo("chat.response.started", { requestId, regenerate, mode });

  const persist = async (content: string, status: "complete" | "interrupted" | "error") => {
    try {
      const update = supabase.from("messages").update({ content, status }).eq("id", assistant.id);
      // Explicit Stop releases the active-row guard before this content write finishes.
      // A late finalizer can only touch its own row, never complete a stopped generation.
      const guarded = status === "interrupted" ? update.in("status", ["streaming", "interrupted"]) : update.eq("status", "streaming");
      const { data, error } = await guarded.select("id").maybeSingle();
      if (error || !data) {
        logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status });
        return false;
      }
      return true;
    } catch {
      logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status });
      return false;
    }
  };
  let prompt: ReturnType<typeof toProviderMessages> | undefined;
  let context: ReturnType<typeof buildContext>["diagnostics"] | undefined;
  try {
    const started = Date.now();
    const plan = buildContext({
      responseMode: mode,
      capabilities: contextCapabilitiesFor(mode),
      preferences: preferenceState.preferences,
      preferenceReadFailed: Boolean(preferenceState.error),
      summary: null,
      room,
      files,
      messages: rows.map((row) => ({ role: row.role as "user" | "assistant", content: row.content, position: row.position })),
      currentPosition: userMessage.position,
    });
    prompt = toProviderMessages(plan);
    context = plan.diagnostics;
    const profileIncluded = plan.blocks.some((block) => block.id === "profile" && block.included);
    const roomIncluded = plan.blocks.some((block) => block.id === "room" && block.included);
    const pinsIncluded = plan.blocks.some((block) => block.id === "pins" && block.included);
    const fileIncluded = plan.blocks.some((block) => block.id === "file" && block.included);
    const summaryIncluded = plan.blocks.some((block) => block.id === "thread_summary" && block.included);
    logInfo("context.built", {
      requestId,
      durationMs: Date.now() - started,
      profileIncluded,
      roomIncluded,
      pinsIncluded,
      fileIncluded,
      fileCount: files?.length ?? 0,
      summaryIncluded,
      sourceCount: plan.blocks.filter((block) => block.included).length,
      recentMessageCount: plan.diagnostics.recentMessageCount,
      estimatedTokens: plan.budget.estimatedTokens,
      truncated: plan.budget.truncated,
      policyVersion: CONTEXT_POLICY_VERSION,
    });
  } catch {
    logError("context.build.failed", { requestId, code: operationalCodes.contextBuildFailed, stage: "context", durationMs: durationMs() });
    logError("chat.response.failed", { requestId, code: operationalCodes.contextBuildFailed, stage: "context", durationMs: durationMs() });
    try { await persist("Response unavailable.", "error"); } catch { logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status: "error" }); }
    return NextResponse.json({ error: safeError }, { status: 503 });
  }
  if (!prompt || !context) return NextResponse.json({ error: safeError }, { status: 503 });

  const aborter = new AbortController();
  let clientCancelled = false;
  const onRequestAbort = () => { clientCancelled = true; aborter.abort(); };
  request.signal.addEventListener("abort", onRequestAbort, { once: true });
  if (request.signal.aborted) onRequestAbort();
  let providerTimedOut = false;
  const timeout = setTimeout(() => { providerTimedOut = true; aborter.abort(); }, 120_000);
  const providerStartedAt = Date.now();
  let providerTtftMs: number | null = null;
  let finishReason = "unspecified";
  const timeoutError = "The provider took too long to finish this response. Please try again.";
  let responseStream: ReadableStream<Uint8Array>;
  try { responseStream = await chatProvider.stream(mode, prompt, aborter.signal); }
  catch (error) {
    const interrupted = clientCancelled || request.signal.aborted;
    if (interrupted) logWarn("chat.response.interrupted", { requestId, stage: "provider", status: "interrupted", durationMs: durationMs() });
    else logError("chat.response.failed", { requestId, durationMs: durationMs(), ...providerFailureFields(error) });
    try { await persist(clientCancelled ? "Response stopped." : "Response unavailable.", clientCancelled ? "interrupted" : "error"); }
    finally { clearTimeout(timeout); request.signal.removeEventListener("abort", onRequestAbort); }
    return NextResponse.json({ error: providerTimedOut ? timeoutError : safeError }, { status: providerTimedOut ? 504 : 502 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const filter = createReasoningStreamFilter();
      let output = ""; let completed = false; let sealed = false;
      let interruptedSave: Promise<boolean> | undefined;
      const publish = (text: string) => {
        if (!text) return;
        if (providerTtftMs === null) providerTtftMs = Date.now() - providerStartedAt;
        output += text;
        if (!clientCancelled) controller.enqueue(encoder.encode(event("delta", { text })));
      };
      const seal = () => {
        if (sealed) return;
        sealed = true;
        publish(filter.finish());
        if (filter.reasoningBlockCount > 0) {
          console.info(JSON.stringify({
            event: "ai.reasoning.filtered",
            requestId: assistant.id,
            reasoningBlockCount: filter.reasoningBlockCount,
          }));
        }
      };
      const save = async (status: "complete" | "interrupted" | "error") => {
        seal();
        const content = output || (status === "interrupted" ? "Response stopped." : "Response unavailable.");
        if (status === "interrupted") return interruptedSave ??= persist(content, status);
        return persist(content, status);
      };
      try {
        if (clientCancelled) throw new Error("Response aborted.");
        controller.enqueue(encoder.encode(event("start", { id: assistant.id, position: assistant.position, context })));
        for await (const item of readOpenAiSse(responseStream, aborter.signal)) {
          if (item.type === "done") { completed = true; finishReason = item.finishReason ?? "unspecified"; break; }
          publish(filter.push(item.text));
        }
        seal();
        if (clientCancelled || request.signal.aborted) {
          const saved = await save("interrupted");
          logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
          if (!clientCancelled) controller.enqueue(encoder.encode(saved ? event("status", { status: "interrupted" }) : event("error", { error: safeError })));
        } else if (completed && output.length > 0) {
          if (await save("complete")) {
            logInfo("chat.response.completed", { requestId, status: "complete", durationMs: durationMs() });
            controller.enqueue(encoder.encode(event("status", { status: "complete" })));
          } else {
            await save("error");
            logError("chat.response.failed", { requestId, stage: "persist", code: operationalCodes.assistantPersistFailed, status: "error", durationMs: durationMs() });
            controller.enqueue(encoder.encode(event("error", { error: safeError })));
          }
        } else {
          await save("error");
          logError("chat.response.failed", { requestId, stage: "stream", code: operationalCodes.aiProviderFailed, status: "error", durationMs: durationMs() });
          controller.enqueue(encoder.encode(event("error", { error: safeError })));
        }
      } catch (error) {
        if (error instanceof ProviderStreamError) finishReason = error.finishReason;
        else if (providerTimedOut) finishReason = "timeout";
        const interrupted = clientCancelled || request.signal.aborted;
        let saved = false;
        try { saved = await save(interrupted ? "interrupted" : "error"); } catch { logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist" }); }
        if (interrupted) logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
        else logError("chat.response.failed", { requestId, stage: "stream", code: operationalCodes.aiProviderFailed, status: "error", durationMs: durationMs() });
        if (!interrupted) controller.enqueue(encoder.encode(event("error", { error: error instanceof ProviderStreamError ? error.message : providerTimedOut ? timeoutError : safeError })));
        else if (!clientCancelled) controller.enqueue(encoder.encode(saved ? event("status", { status: "interrupted" }) : event("error", { error: safeError })));
      } finally {
        logInfo("chat.response.metrics", {
          requestId, logicalMode: mode, provider: providerFor(mode), providerTtftMs, generationDurationMs: Date.now() - providerStartedAt,
          totalDurationMs: Date.now() - requestStartedAt, finishReason,
          outputChars: output.length, streamCompleted: completed,
        });
        clearTimeout(timeout);
        aborter.abort();
        request.signal.removeEventListener("abort", onRequestAbort);
        if (!clientCancelled) { controller.enqueue(encoder.encode(event("done", {}))); controller.close(); }
      }
    },
    cancel() { clientCancelled = true; aborter.abort(); },
  });
  return new Response(stream, { headers });
}

function providerFailureFields(error: unknown) {
  const base = { stage: "provider", code: operationalCodes.aiProviderFailed };
  if (!(error instanceof Error)) return { ...base, reason: "request_failed" };
  if (error.message.startsWith("Missing AI configuration:")) {
    const missing = error.message.slice("Missing AI configuration:".length).split(",").map((name) => name.trim()).filter((name) => /^AI_[A-Z0-9_]+$/.test(name));
    return { ...base, reason: "missing_configuration", ...(missing.length ? { missing } : {}) };
  }
  if (error.message.startsWith("Unsupported AI_PROVIDER")) return { ...base, reason: "unsupported_provider" };
  return { ...base, reason: "request_failed" };
}
