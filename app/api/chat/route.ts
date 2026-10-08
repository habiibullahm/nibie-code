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
import { citationSourcesIncludedInContext } from "@/lib/citations/included";
import { createCitationStreamFilter } from "@/lib/citations/parse";
import { citationViewsFromPrepared, persistMessageSources } from "@/lib/citations/persist";
import { citationInstructionFor } from "@/lib/citations/prepare";
import type { SourceReference } from "@/lib/citations/types";
import { stopPollMs, stoppedPlaceholder } from "@/lib/chat/stop";
import { buildContext } from "@/lib/context/build-context";
import { CONTEXT_POLICY_VERSION } from "@/lib/context/context-policy";
import type { FileContextInput } from "@/lib/context/context-types";
import type { RoomContextInput } from "@/lib/context/room-context";
import { deferThreadSummaryMaintenance, loadThreadSummary } from "@/lib/context/thread-summary-store";
import { parseSelectedFileIds } from "@/lib/files/inspect";
import { contextAttachments, type AttachmentContextRow, type ContextMessageRow } from "@/lib/attachments/context";
import { MAX_FILES_PER_MESSAGE } from "@/lib/files/limits";
import { searchRoomFiles } from "@/lib/files/search";
import { prioritizeRoomFileMatches } from "@/lib/files/retrieval";
import { roomContextFromRows, type PinContextRow, type RoomBriefRow } from "@/lib/rooms/map";
import { loadOwnerPreferences } from "@/lib/preferences/store";
import { handleRecallTurn } from "@/lib/recall/handle";
import { retrieveRelevantMemories } from "@/lib/recall/retrieve";
import type { MemoryRecord, RecallOperationStatus } from "@/lib/recall/types";
import { operationalCodes } from "@/lib/observability/codes";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { requestIdFrom } from "@/lib/observability/request-id";
import { weeklyCreditCost, WEEKLY_FREE_CREDIT_LIMIT } from "@/lib/usage/policy";
import { createDeepResearchChatResponse } from "@/lib/research/chat-stream";
import { createAutoWebActionChatResponse } from "@/lib/actions/auto-web-response";
import { decideWebSearch } from "@/lib/web/routing";
import type { WebContextInput } from "@/lib/web/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const encoder = new TextEncoder();
const safeError = "Nibie couldn't complete that response. Please try again.";
function event(type: string, data: unknown) { return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; }

type WeeklyReservationRow = {
  accepted: boolean;
  credits_charged: number;
  credits_used: number;
  credits_remaining: number;
  reset_at: string;
};

/**
 * Shared HTTP weekly-usage gate for paths that open SSE before the normal reserve point
 * (Action/web.search and Deep Research). Exhausted accounts get the same 429 JSON as Fast path
 * so the client can set weeklyLimitResetAt. On accept, the reservation is released so those
 * streams keep their existing reserve → start → release lifecycle.
 */
async function rejectWeeklyUsageBeforeStream(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  assistantId: string;
  mode: keyof typeof weeklyCreditCost;
  requestId: string;
}): Promise<NextResponse | null> {
  const { supabase, assistantId, mode, requestId } = input;
  const release = async () => {
    try {
      const { error } = await supabase.rpc("release_weekly_ai_usage", { p_generation_id: assistantId });
      if (error) logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    } catch {
      logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    }
  };
  const markError = async (content: string) => {
    try {
      await supabase.from("messages").update({ content, status: "error" }).eq("id", assistantId).eq("status", "streaming");
    } catch {
      logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status: "error" });
    }
  };

  const reservationStartedAt = Date.now();
  let reservation: WeeklyReservationRow | null = null;
  let reservationError: unknown = null;
  try {
    const result = await supabase.rpc("reserve_weekly_ai_usage", {
      p_generation_id: assistantId,
      p_logical_mode: mode,
    }).single<WeeklyReservationRow>();
    reservation = result.data;
    reservationError = result.error;
  } catch {
    reservationError = new Error("Reservation request failed.");
  }
  const usageReservationMs = Date.now() - reservationStartedAt;

  if (
    reservationError
    || !reservation
    || typeof reservation.accepted !== "boolean"
    || !Number.isInteger(reservation.credits_remaining)
    || reservation.credits_remaining < 0
    || reservation.credits_remaining > WEEKLY_FREE_CREDIT_LIMIT
    || typeof reservation.reset_at !== "string"
    || !Number.isFinite(Date.parse(reservation.reset_at))
  ) {
    logError("weekly_usage.reservation.failed", { requestId, logicalMode: mode, durationMs: usageReservationMs, code: operationalCodes.requestFailed });
    await release();
    await markError("Response unavailable.");
    return NextResponse.json({ error: safeError }, { status: 503 });
  }

  if (!reservation.accepted) {
    logWarn("weekly_usage.limit.rejected", {
      requestId,
      logicalMode: mode,
      creditsCharged: 0,
      creditsRemaining: reservation.credits_remaining,
    });
    await markError("Weekly usage limit reached.");
    return NextResponse.json({
      code: operationalCodes.weeklyUsageLimitRejected,
      error: "You've reached your weekly Nibie usage limit.",
      creditsRemaining: reservation.credits_remaining,
      resetAt: reservation.reset_at,
    }, { status: 429, headers: { "x-request-id": requestId } });
  }

  if (reservation.credits_charged !== weeklyCreditCost[mode]) {
    logError("weekly_usage.reservation.failed", {
      requestId,
      logicalMode: mode,
      durationMs: usageReservationMs,
      reason: "policy_mismatch",
      code: operationalCodes.requestFailed,
    });
    await release();
    await markError("Response unavailable.");
    return NextResponse.json({ error: safeError }, { status: 503 });
  }

  await release();
  return null;
}

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
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return NextResponse.json({ error: "A JSON request is required." }, { status: 415 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const value = body as { conversationId?: unknown; userMessageId?: unknown; regenerate?: unknown; model?: unknown; fileIds?: unknown; deepResearch?: unknown };
  const parsedId = validateConversationId(value?.conversationId);
  const parsedMessageId = validateConversationId(value?.userMessageId);
  const selectedFiles = parseSelectedFileIds(value?.fileIds, MAX_FILES_PER_MESSAGE);
  // The client may name a mode from a fixed vocabulary; it is never a provider model id. Reasoning is server-side routing config,
  // so a stale client's `reasoning` field is simply ignored.
  const requestedModel = value?.model === undefined ? undefined : modelChoiceInputSchema.safeParse(value.model);
  if (!selectedFiles.ok || !parsedId.success || !parsedMessageId.success || (value.regenerate !== undefined && typeof value.regenerate !== "boolean") || (value.deepResearch !== undefined && typeof value.deepResearch !== "boolean") || requestedModel?.success === false) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const regenerate = value.regenerate === true;
  // Explicit Deep Research only — never auto-triggered from question phrasing or Fast/Balanced/High.
  const deepResearch = value.deepResearch === true;
  // Only modes that are configured on the server can be used, whether the client asked for one or the conversation has one saved.
  const { models: availableModels } = getModelOptions();
  const availableModes = availableModels.map((option) => option.id);
  if (requestedModel && requestedModel.data !== "Auto" && !availableModes.includes(requestedModel.data)) return NextResponse.json({ error: "That model isn't available." }, { status: 400 });

  // The conversation, the user message and the recent context only depend on the ids in the request, so they are read together
  // (RLS hides other owners' rows from all three); the message context is trimmed to this message below.
  // Preferences are soft personalization. A failed read uses safe defaults and does not block this authenticated request.
  // Chat attachments of this conversation only (RLS also limits them to the owner); trimmed to the messages in context below.
  // The thread summary is optional context: a failed read is logged and the reply continues without it.
  const [{ data: loadedConversation, error: loadedConversationError }, { data: userMessage, error: messageError }, { data: recent, error: readError }, preferenceState, attachmentResult, summary] = await Promise.all([
    supabase.from("conversations").select("id,selected_model,room_id").eq("id", parsedId.data).maybeSingle(),
    supabase.from("messages").select("id,position,content").eq("id", parsedMessageId.data).eq("conversation_id", parsedId.data).eq("role", "user").eq("status", "complete").maybeSingle(),
    supabase.from("messages").select("id,role,content,status,position").eq("conversation_id", parsedId.data).eq("status", "complete").order("position", { ascending: false }).limit(34),
    loadOwnerPreferences(supabase),
    supabase.from("message_attachments").select("message_id,original_name,mime_type,extracted_text,truncated,page_count,created_at").eq("conversation_id", parsedId.data).order("created_at", { ascending: false }).limit(60),
    loadThreadSummary(supabase, parsedId.data, requestId),
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
    const { data: fileRows, error: fileError } = await supabase.from("room_files").select("id,original_name,extracted_text,extracted_truncated").eq("room_id", conversation.room_id).in("id", selectedFiles.ids);
    if (fileError) return NextResponse.json({ error: safeError }, { status: 503 });
    const byId = new Map((fileRows ?? []).map((row) => [row.id, row]));
    if (selectedFiles.ids.some((id) => !byId.has(id))) return NextResponse.json({ error: "That file isn't available in this room." }, { status: 400 });
    files = selectedFiles.ids.map((id) => {
      const row = byId.get(id)!;
      return { id: row.id, name: row.original_name, text: row.extracted_text, truncated: row.extracted_truncated };
    });
  }
  if (conversation.room_id) {
    const currentText = String(userMessage?.content ?? "").trim();
    const matches = await searchRoomFiles(
      supabase,
      conversation.room_id,
      currentText,
      (files ?? []).flatMap((file) => file.id ? [file.id] : []),
      () => logWarn("room_file.search.failed", { requestId, stage: "room_file_search" }),
      () => logWarn("room_file.search.failed", { requestId, stage: "room_file_search_semantic" }),
    );
    if (matches.length) files = prioritizeRoomFileMatches(files ?? [], matches);
  }
  const mode = requestedModel?.data && requestedModel.data !== "Auto" ? requestedModel.data : resolveMode(normalizeSavedMode(conversation.selected_model), availableModes);
  if (!mode) return NextResponse.json({ error: safeError }, { status: 503 });
  if (messageError) return NextResponse.json({ error: safeError }, { status: 503 });
  if (!userMessage) return NextResponse.json({ error: "Message unavailable." }, { status: 404 });
  if (!validateMessage(userMessage.content).success) return NextResponse.json({ error: "Invalid saved message." }, { status: 400 });
  const rows = recent?.filter((row) => row.position <= userMessage.position && (row.role === "user" || row.role === "assistant") && row.status === "complete").slice(0, 32);
  if (readError || !rows?.length) return NextResponse.json({ error: safeError }, { status: 503 });
  // An attachment that cannot be read is never silently dropped: the reply waits for a working read instead.
  // A database without the attachments table (not migrated yet) simply has none.
  if (attachmentResult.error && !schemaUnavailable(attachmentResult.error)) {
    logError("chat.response.failed", { requestId, stage: "attachments", code: operationalCodes.attachmentReadFailed });
    return NextResponse.json({ error: safeError }, { status: 503 });
  }
  const attachments = contextAttachments(attachmentResult.error ? [] : (attachmentResult.data ?? []) as AttachmentContextRow[], rows as ContextMessageRow[], userMessage.id);
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
  // Deep Research logs chat.response.started inside its own stream path.
  if (!deepResearch) logInfo("chat.response.started", { requestId, regenerate, mode });

  // Explicit recall: save/forget intent and retrieval never block the reply.
  // Fail closed when preferences could not be read so a disabled user is not briefly re-enabled.
  // Always run handle on non-regenerate turns so disabled/failed outcomes reach the model truthfully.
  const recallEnabled = !preferenceState.error && preferenceState.preferences.recallEnabled !== false;
  let recallOperation: RecallOperationStatus = "none";
  if (!regenerate) {
    try {
      const recallResult = await handleRecallTurn({
        supabase,
        userId: user.id,
        message: userMessage.content,
        recallEnabled,
        conversationId: conversation.id,
        messageId: userMessage.id,
        requestId,
      });
      recallOperation = recallResult.status;
    } catch {
      recallOperation = "save_failed";
      logWarn("memory.write.failed", { requestId, category: "exception", code: operationalCodes.recallWriteFailed });
    }
  } else if (!recallEnabled) {
    logInfo("memory.disabled", { requestId, stage: "turn" });
  }

  let memories: MemoryRecord[] | undefined;
  if (recallEnabled) {
    const retrieveStarted = Date.now();
    logInfo("memory.retrieve.started", { requestId });
    try {
      const retrieved = await retrieveRelevantMemories({
        supabase,
        query: userMessage.content,
        recallEnabled,
        requestId,
      });
      if (retrieved.memories.length) memories = retrieved.memories;
      logInfo("memory.retrieve.completed", {
        requestId,
        count: retrieved.memories.length,
        durationMs: Date.now() - retrieveStarted,
        degraded: retrieved.degraded,
      });
      if (retrieved.degraded) {
        logWarn("memory.retrieve.completed", { requestId, category: "degraded", code: operationalCodes.recallRetrieveFailed });
      }
    } catch {
      logWarn("memory.retrieve.completed", {
        requestId,
        category: "exception",
        durationMs: Date.now() - retrieveStarted,
        code: operationalCodes.recallRetrieveFailed,
      });
    }
  }

  // Deep Research is an explicit alternate path: bounded multi-source orchestrator + cited synthesis.
  // It does not use auto web routing and must not overload Fast/Balanced/High.
  if (deepResearch) {
    const weeklyRejected = await rejectWeeklyUsageBeforeStream({
      supabase,
      assistantId: assistant.id,
      mode,
      requestId,
    });
    if (weeklyRejected) return weeklyRejected;
    const planMode = (availableModes.includes("Fast") ? "Fast" : mode) as typeof mode;
    return createDeepResearchChatResponse({
      request,
      requestId,
      requestStartedAt,
      supabase,
      userId: user.id,
      conversationId: conversation.id,
      assistant: { id: assistant.id, position: assistant.position },
      userMessage: { id: userMessage.id, content: userMessage.content, position: userMessage.position },
      mode,
      availablePlanMode: planMode,
      preferences: preferenceState.preferences,
      preferenceReadFailed: Boolean(preferenceState.error),
      summary,
      room,
      files,
      attachments,
      memories,
      recallOperation,
      rows,
    });
  }

  // Automatic Web Search V1 runs through Action Runtime (web.search) — allowlisted, audited, stoppable.
  // Deterministic routing decides; no extra LLM round for the Action decision. Fast path (no search) is unchanged.
  const webDecision = decideWebSearch(userMessage.content, { hasRoomFileContext: Boolean(files?.length) });
  if (webDecision.search) {
    const weeklyRejected = await rejectWeeklyUsageBeforeStream({
      supabase,
      assistantId: assistant.id,
      mode,
      requestId,
    });
    if (weeklyRejected) return weeklyRejected;
    return createAutoWebActionChatResponse({
      request,
      requestId,
      requestStartedAt,
      supabase,
      userId: user.id,
      conversationId: conversation.id,
      roomId: conversation.room_id ?? null,
      assistant: { id: assistant.id, position: assistant.position },
      userMessage: { id: userMessage.id, content: userMessage.content, position: userMessage.position },
      mode,
      preferences: preferenceState.preferences,
      preferenceReadFailed: Boolean(preferenceState.error),
      summary,
      room,
      files,
      attachments,
      memories,
      recallOperation,
      rows,
      webRouteReason: webDecision.reason,
    });
  }
  logInfo("web.route.decided", { requestId, search: false, reason: webDecision.reason });

  // No-action path: no web sources; chat continues as before Actions V1.
  let web: WebContextInput[] | undefined;
  const preparedCitationSources: SourceReference[] = [];
  let citationSources: SourceReference[] = [];
  let citationViews: ReturnType<typeof citationViewsFromPrepared> = [];
  const webVerificationUnavailable = false;

  // Every save of this generation only applies while its row is still streaming. An explicit Stop has already written the
  // text the user saw and marked the row interrupted, so a late finish, error or disconnect save can never replace it.
  const replyStopped = async () => {
    const { data, error } = await supabase.from("messages").select("status").eq("id", assistant.id).maybeSingle();
    return !error && data?.status === "interrupted";
  };
  // Citations are advertised on SSE start; if Stop wins the content write, still attach message_sources so reload
  // keeps Sources alongside any [n] markers in the kept partial. Once-only: Stop + generation race must not double-insert.
  let citationSourcesPersisted = false;
  const persistCitationSourcesForKeptReply = async (keptContent: string) => {
    if (citationSourcesPersisted || !citationSources.length) return;
    if (!keptContent.trim() || keptContent === stoppedPlaceholder) return;
    citationSourcesPersisted = true;
    const savedSources = await persistMessageSources({
      supabase,
      userId: user.id,
      conversationId: conversation.id,
      messageId: assistant.id,
      sources: citationSources,
    });
    if (!savedSources.ok) {
      citationSourcesPersisted = false;
      logWarn("citation.sources.persist_failed", { requestId, sourceCount: citationSources.length });
    }
  };
  const persist = async (content: string, status: "complete" | "interrupted" | "error"): Promise<"saved" | "stopped" | "failed"> => {
    try {
      const { data, error } = await supabase.from("messages").update({ content, status }).eq("id", assistant.id).eq("status", "streaming").select("id").maybeSingle();
      if (!error && data) {
        if (status === "complete" || status === "interrupted") {
          await persistCitationSourcesForKeptReply(content);
        }
        return "saved";
      }
      if (!error && await replyStopped()) {
        // Stop already saved the visible text; still persist Sources for that kept partial.
        await persistCitationSourcesForKeptReply(content);
        return "stopped";
      }
    } catch { /* reported below */ }
    logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status });
    return "failed";
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
      summary,
      room,
      files,
      attachments,
      web,
      webVerificationUnavailable,
      memories,
      recallOperation,
      messages: rows.map((row) => ({ role: row.role as "user" | "assistant", content: row.content, position: row.position })),
      currentPosition: userMessage.position,
    });
    prompt = toProviderMessages(plan);
    context = plan.diagnostics;
    // Citation allowlist is only handles that made it into the rendered web block.
    citationSources = citationSourcesIncludedInContext(preparedCitationSources, plan.includedCitationHandles);
    citationViews = citationViewsFromPrepared(citationSources);
    // Put citation rules in the authoritative system message — not only the untrusted web preface —
    // so the model emits [SOURCE:web:n] instead of inventing a prose Sources list.
    if (citationSources.length && prompt[0]?.role === "system") {
      const citationRules = citationInstructionFor(citationSources);
      if (citationRules) {
        prompt = [{ role: "system", content: `${prompt[0].content}\n\n${citationRules}` }, ...prompt.slice(1)];
      }
    }
    if (preparedCitationSources.length || citationSources.length) {
      logInfo("citation.sources.prepared", {
        requestId,
        sourceCount: citationSources.length,
      });
    }
    const profileIncluded = plan.blocks.some((block) => block.id === "profile" && block.included);
    const roomIncluded = plan.blocks.some((block) => block.id === "room" && block.included);
    const pinsIncluded = plan.blocks.some((block) => block.id === "pins" && block.included);
    const fileIncluded = plan.blocks.some((block) => block.id === "file" && block.included);
    const webIncluded = plan.blocks.some((block) => block.id === "web" && block.included);
    const memoryIncluded = plan.blocks.some((block) => block.id === "memory" && block.included);
    const summaryIncluded = plan.blocks.some((block) => block.id === "thread_summary" && block.included);
    logInfo("context.built", {
      requestId,
      durationMs: Date.now() - started,
      profileIncluded,
      roomIncluded,
      pinsIncluded,
      fileIncluded,
      memoryIncluded,
      fileCount: files?.length ?? 0,
      attachmentCount: attachments.length,
      webIncluded,
      webCount: web?.length ?? 0,
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
  if (clientCancelled) {
    request.signal.removeEventListener("abort", onRequestAbort);
    await persist("Response stopped.", "interrupted");
    return new Response(null, { status: 499 });
  }

  // Reserve after validation, ownership, the idempotent generation claim, and context construction. The database derives the
  // week and credits from its clock and the trusted logical mode; no client preflight is needed.
  const releaseReservation = async () => {
    try {
      const { error } = await supabase.rpc("release_weekly_ai_usage", { p_generation_id: assistant.id });
      if (error) logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    } catch {
      logError("weekly_usage.reservation.release_failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    }
  };
  const reservationStartedAt = Date.now();
  let reservation: { accepted: boolean; credits_charged: number; credits_used: number; credits_remaining: number; reset_at: string } | null = null;
  let reservationError: unknown = null;
  try {
    const result = await supabase.rpc("reserve_weekly_ai_usage", {
      p_generation_id: assistant.id,
      p_logical_mode: mode,
    }).single<{ accepted: boolean; credits_charged: number; credits_used: number; credits_remaining: number; reset_at: string }>();
    reservation = result.data;
    reservationError = result.error;
  } catch {
    reservationError = new Error("Reservation request failed.");
  }
  const usageReservationMs = Date.now() - reservationStartedAt;
  if (reservationError || !reservation || typeof reservation.accepted !== "boolean"
    || !Number.isInteger(reservation.credits_remaining) || reservation.credits_remaining < 0 || reservation.credits_remaining > WEEKLY_FREE_CREDIT_LIMIT
    || typeof reservation.reset_at !== "string" || !Number.isFinite(Date.parse(reservation.reset_at))) {
    logError("weekly_usage.reservation.failed", { requestId, logicalMode: mode, durationMs: usageReservationMs, code: operationalCodes.requestFailed });
    await releaseReservation();
    try { await persist(clientCancelled ? "Response stopped." : "Response unavailable.", clientCancelled ? "interrupted" : "error"); }
    finally { request.signal.removeEventListener("abort", onRequestAbort); }
    if (clientCancelled || request.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ error: safeError }, { status: 503 });
  }
  if (!reservation.accepted) {
    logWarn("weekly_usage.limit.rejected", { requestId, logicalMode: mode, creditsCharged: 0, creditsRemaining: reservation.credits_remaining });
    try { await persist("Weekly usage limit reached.", "error"); }
    finally { request.signal.removeEventListener("abort", onRequestAbort); }
    return NextResponse.json({
      code: operationalCodes.weeklyUsageLimitRejected,
      error: "You've reached your weekly Nibie usage limit.",
      creditsRemaining: reservation.credits_remaining,
      resetAt: reservation.reset_at,
    }, { status: 429, headers: { "x-request-id": requestId } });
  }
  if (reservation.credits_charged !== weeklyCreditCost[mode]) {
    logError("weekly_usage.reservation.failed", { requestId, logicalMode: mode, durationMs: usageReservationMs, reason: "policy_mismatch", code: operationalCodes.requestFailed });
    await releaseReservation();
    try { await persist("Response unavailable.", "error"); }
    finally { request.signal.removeEventListener("abort", onRequestAbort); }
    return NextResponse.json({ error: safeError }, { status: 503 });
  }
  logInfo("weekly_usage.reservation.accepted", {
    requestId, logicalMode: mode, creditsCharged: reservation.credits_charged,
    creditsRemaining: reservation.credits_remaining, reservationLatencyMs: usageReservationMs,
  });

  if (clientCancelled || request.signal.aborted) {
    await releaseReservation();
    try { await persist("Response stopped.", "interrupted"); }
    finally { request.signal.removeEventListener("abort", onRequestAbort); }
    return new Response(null, { status: 499 });
  }

  // A browser disconnect does not always reach request.signal (it does not on every host), so Stop is also read from the
  // reply row: once Stop marks it interrupted (from any instance), the provider stream is aborted here.
  let userStopped = false;
  let stopCheck: Promise<void> | null = null;
  const checkStopped = async () => {
    try {
      const { data, error } = await supabase.from("messages").select("status").eq("id", assistant.id).maybeSingle();
      if (error || data?.status === "streaming" || userStopped || aborter.signal.aborted) return;
      userStopped = true;
      clearInterval(stopWatch);
      logInfo("chat.response.user_stopped", { requestId, reason: "user_stopped", stage: "generation", status: data?.status ?? "missing", durationMs: durationMs() });
      aborter.abort();
    } catch { /* a failed check is retried on the next tick */ } finally { stopCheck = null; }
  };
  const stopWatch = setInterval(() => { stopCheck ??= checkStopped(); }, stopPollMs);
  let providerTimedOut = false;
  const timeout = setTimeout(() => { providerTimedOut = true; aborter.abort(); }, 120_000);
  const providerStartedAt = Date.now();
  let providerTtftMs: number | null = null;
  let finishReason = "unspecified";
  const timeoutError = "The provider took too long to finish this response. Please try again.";
  let responseStream: ReadableStream<Uint8Array>;
  try { responseStream = await chatProvider.stream(mode, prompt, aborter.signal); }
  catch (error) {
    clearInterval(stopWatch);
    const interrupted = userStopped || clientCancelled || request.signal.aborted;
    if (interrupted) logWarn("chat.response.interrupted", { requestId, stage: "provider", status: "interrupted", durationMs: durationMs() });
    else logError("chat.response.failed", { requestId, durationMs: durationMs(), ...providerFailureFields(error) });
    if (!interrupted) await releaseReservation();
    try { if (!userStopped) await persist(clientCancelled ? stoppedPlaceholder : "Response unavailable.", clientCancelled ? "interrupted" : "error"); }
    finally { clearTimeout(timeout); request.signal.removeEventListener("abort", onRequestAbort); }
    return NextResponse.json({ error: providerTimedOut ? timeoutError : safeError }, { status: providerTimedOut ? 504 : 502 });
  }

  let usageStarted = false;
  try {
    const { data, error } = await supabase.rpc("start_weekly_ai_usage", { p_generation_id: assistant.id });
    usageStarted = data === true && !error;
  } catch {
    usageStarted = false;
  }
  if (!usageStarted) {
    logError("weekly_usage.start.failed", { requestId, logicalMode: mode, code: operationalCodes.requestFailed });
    aborter.abort();
    await releaseReservation();
    try { await persist(clientCancelled ? "Response stopped." : "Response unavailable.", clientCancelled ? "interrupted" : "error"); }
    finally { clearTimeout(timeout); request.signal.removeEventListener("abort", onRequestAbort); }
    if (clientCancelled || request.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ error: safeError }, { status: 503 });
  }

  // Summary maintenance runs after the response finishes, and only for a reply saved as complete. It is best effort:
  // whatever happens to it, the saved reply stays as it is.
  const summaryMaintenance = deferThreadSummaryMaintenance({ supabase, conversationId: conversation.id, requestId });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reasoningFilter = createReasoningStreamFilter();
      const citationFilter = createCitationStreamFilter(citationSources);
      let output = ""; let completed = false; let sealed = false;
      let interruptedSave: Promise<"saved" | "stopped" | "failed"> | undefined;
      const publish = (text: string) => {
        if (!text) return;
        if (providerTtftMs === null) providerTtftMs = Date.now() - providerStartedAt;
        output += text;
        if (!clientCancelled) controller.enqueue(encoder.encode(event("delta", { text })));
      };
      const feedModelText = (chunk: string) => {
        if (!chunk) return;
        publish(citationFilter.push(reasoningFilter.push(chunk)));
      };
      const logCitationStats = () => {
        logInfo("citation.references.parsed", {
          requestId,
          sourceCount: citationSources.length,
          citationCount: citationFilter.citationCount,
        });
        if (citationFilter.invalidCitationCount > 0) {
          logInfo("citation.references.invalid", {
            requestId,
            sourceCount: citationSources.length,
            invalidCitationCount: citationFilter.invalidCitationCount,
          });
        }
      };
      const seal = () => {
        if (sealed) return;
        sealed = true;
        const afterReasoning = reasoningFilter.finish();
        if (afterReasoning) publish(citationFilter.push(afterReasoning));
        publish(citationFilter.finish());
        logCitationStats();
        if (reasoningFilter.reasoningBlockCount > 0) {
          console.info(JSON.stringify({
            event: "ai.reasoning.filtered",
            requestId: assistant.id,
            reasoningBlockCount: reasoningFilter.reasoningBlockCount,
          }));
        }
      };
      const save = async (status: "complete" | "interrupted" | "error") => {
        seal();
        // An explicit Stop already saved the text its user saw; the generation's own output is never written over it.
        if (userStopped) {
          await persistCitationSourcesForKeptReply(output);
          return "stopped" as const;
        }
        const content = output || (status === "interrupted" ? stoppedPlaceholder : "Response unavailable.");
        if (status === "interrupted") return interruptedSave ??= persist(content, status);
        return persist(content, status);
      };
      const reportStopped = () => {
        logWarn("chat.response.interrupted", { requestId, status: "interrupted", reason: "user_stopped", durationMs: durationMs() });
        if (!clientCancelled) controller.enqueue(encoder.encode(event("status", { status: "interrupted" })));
      };
      try {
        if (clientCancelled) throw new Error("Response aborted.");
        controller.enqueue(encoder.encode(event("start", {
          id: assistant.id,
          position: assistant.position,
          context,
          ...(citationViews.length ? { sources: citationViews } : {}),
        })));
        for await (const item of readOpenAiSse(responseStream, aborter.signal)) {
          if (item.type === "done") { completed = true; finishReason = item.finishReason ?? "unspecified"; break; }
          feedModelText(item.text);
        }
        seal();
        if (userStopped || clientCancelled || request.signal.aborted) {
          const saved = await save("interrupted");
          logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
          if (!clientCancelled) controller.enqueue(encoder.encode(saved !== "failed" ? event("status", { status: "interrupted" }) : event("error", { error: safeError })));
        } else if (completed && output.length > 0) {
          const saved = await save("complete");
          if (saved === "saved") {
            logInfo("chat.response.completed", { requestId, status: "complete", durationMs: durationMs() });
            try { summaryMaintenance.complete(assistant.position); } catch { /* best effort; never affects the reply */ }
            controller.enqueue(encoder.encode(event("status", { status: "complete" })));
          } else if (saved === "stopped") {
            // Stop landed after the provider finished but before this save: the stopped reply stands.
            reportStopped();
          } else {
            await save("error");
            logError("chat.response.failed", { requestId, stage: "persist", code: operationalCodes.assistantPersistFailed, status: "error", durationMs: durationMs() });
            controller.enqueue(encoder.encode(event("error", { error: safeError })));
          }
        } else if (await save("error") === "stopped") {
          reportStopped();
        } else {
          logError("chat.response.failed", { requestId, stage: "stream", code: operationalCodes.aiProviderFailed, status: "error", durationMs: durationMs() });
          controller.enqueue(encoder.encode(event("error", { error: safeError })));
        }
      } catch (error) {
        if (error instanceof ProviderStreamError) finishReason = error.finishReason;
        else if (providerTimedOut) finishReason = "timeout";
        let saved: "saved" | "stopped" | "failed" = "failed";
        try { saved = await save(userStopped || clientCancelled || request.signal.aborted ? "interrupted" : "error"); } catch { logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist" }); }
        const interrupted = saved === "stopped" || userStopped || clientCancelled || request.signal.aborted;
        if (interrupted) logWarn("chat.response.interrupted", { requestId, status: "interrupted", durationMs: durationMs() });
        else logError("chat.response.failed", { requestId, stage: "stream", code: operationalCodes.aiProviderFailed, status: "error", durationMs: durationMs() });
        if (!interrupted) controller.enqueue(encoder.encode(event("error", { error: error instanceof ProviderStreamError ? error.message : providerTimedOut ? timeoutError : safeError })));
        else if (!clientCancelled) controller.enqueue(encoder.encode(saved !== "failed" ? event("status", { status: "interrupted" }) : event("error", { error: safeError })));
      } finally {
        logInfo("chat.response.metrics", {
          requestId, logicalMode: mode, provider: providerFor(mode), providerTtftMs, generationDurationMs: Date.now() - providerStartedAt,
          appBeforeProviderMs: providerStartedAt - requestStartedAt, usageReservationMs, totalDurationMs: Date.now() - requestStartedAt, finishReason,
          outputChars: output.length, streamCompleted: completed,
        });
        clearTimeout(timeout);
        clearInterval(stopWatch);
        aborter.abort();
        request.signal.removeEventListener("abort", onRequestAbort);
        try { summaryMaintenance.finish(); } catch { /* best effort */ }
        if (!clientCancelled) { controller.enqueue(encoder.encode(event("done", {}))); controller.close(); }
      }
    },
    cancel() { clientCancelled = true; clearInterval(stopWatch); aborter.abort(); },
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
