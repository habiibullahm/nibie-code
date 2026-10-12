import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth/get-user";
import { schemaUnavailable } from "@/lib/chat/schema-error";
import { validateConversationId, validateMessage, type ChatModel } from "@/lib/chat/validation";
import { resolveMode } from "@/lib/chat/models";
import { modelChoiceInputSchema, normalizeSavedMode } from "@/lib/chat/legacy-mode";
import { chatProvider, configuredModelLabel } from "@/lib/ai/provider";
import { toProviderMessages } from "@/lib/ai/provider-messages";
import { contextCapabilitiesFor, getModelOptions, providerFor } from "@/lib/ai/registry";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { citationSourcesIncludedInContext } from "@/lib/citations/included";
import { citationViewsFromPrepared } from "@/lib/citations/persist";
import { citationInstructionFor } from "@/lib/citations/prepare";
import type { SourceReference } from "@/lib/citations/types";
import { stoppedPlaceholder } from "@/lib/chat/stop";
import { createGenerationPersistence } from "@/lib/chat/orchestration/persist-result";
import { createGenerationLifecycle } from "@/lib/chat/orchestration/generation-lifecycle";
import { chatSseEvent as event, createGenerationStream } from "@/lib/chat/orchestration/stream-response";
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
import { reserveUsageBeforeGeneration } from "@/lib/usage/guards";
import type { UsageKind } from "@/lib/usage/policy";
import { estimateUsageFromText, withCostEstimate, type GenerationCostEstimate } from "@/lib/usage/provider-usage";
import { logGenerationTelemetry } from "@/lib/usage/telemetry";
import { createDeepResearchChatResponse } from "@/lib/research/chat-stream";
import {
  createAutoGitHubActionChatResponse,
  createAutoWebActionChatResponse,
} from "@/lib/actions/auto-web-response";
import { decideGitHubRead } from "@/lib/github/routing";
import { decideWebSearch } from "@/lib/web/routing";
import type { WebContextInput } from "@/lib/web/types";
import { detectHistoryRecallIntent } from "@/lib/history-recall/intent";
import { createHistoryRecallResponse } from "@/lib/history-recall/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const encoder = new TextEncoder();
const safeError = "Nibie couldn't complete that response. Please try again.";

/**
 * Shared HTTP usage gate for paths that open SSE before synthesis
 * (Action/web.search and Deep Research). Enforces weekly credits AND dollar spend ceilings.
 *
 * On accept, the reservation is kept held for this generation id. Downstream streams must not
 * release-then-re-reserve: `reserve_weekly_ai_usage` returns accepted=false once released_at is set.
 * Pass `weeklyUsageReserved: true` and skip a second reserve; release only on early failure before start.
 */
async function rejectWeeklyUsageBeforeStream(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  assistantId: string;
  mode: ChatModel;
  requestId: string;
  usageKind?: UsageKind;
}): Promise<NextResponse | null> {
  const { supabase, userId, assistantId, mode, requestId, usageKind = "chat" } = input;
  const markError = async (content: string) => {
    try {
      await supabase.from("messages").update({ content, status: "error" }).eq("id", assistantId).eq("status", "streaming");
    } catch {
      logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status: "error" });
    }
  };

  const gate = await reserveUsageBeforeGeneration({
    supabase,
    userId,
    generationId: assistantId,
    mode,
    usageKind,
    requestId,
  });
  if (gate.ok) {
    logInfo("weekly_usage.reservation.held_for_stream", {
      requestId,
      logicalMode: mode,
      usageKind,
      creditsCharged: gate.creditsCharged,
      spendReservedMicros: gate.spendReservedMicros,
    });
    return null;
  }

  await markError(gate.code === operationalCodes.weeklyUsageLimitRejected
    ? "Weekly usage limit reached."
    : gate.code === operationalCodes.aiSpendLimitRejected
      ? "AI spend budget reached."
      : "Response unavailable.");

  if (gate.status === 429) {
    return NextResponse.json({
      code: gate.code,
      error: gate.error,
      ...(typeof gate.creditsRemaining === "number" ? { creditsRemaining: gate.creditsRemaining } : {}),
      ...(gate.resetAt ? { resetAt: gate.resetAt } : {}),
    }, { status: 429, headers: { "x-request-id": requestId } });
  }
  return NextResponse.json({ error: safeError }, { status: 503 });
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
  const historyIntent = !deepResearch && typeof userMessage?.content === "string"
    ? detectHistoryRecallIntent(userMessage.content) : null;
  if (!historyIntent && requestedModel && requestedModel.data !== "Auto" && !availableModes.includes(requestedModel.data)) return NextResponse.json({ error: "That model isn't available." }, { status: 400 });
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
  if (conversation.room_id && !historyIntent) {
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
  if (!mode && !historyIntent) return NextResponse.json({ error: safeError }, { status: 503 });
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

  if (historyIntent) {
    return createHistoryRecallResponse({
      supabase, request, requestId, ownerId: user.id, conversationId: conversation.id,
      roomId: conversation.room_id ?? null, assistant, intent: historyIntent,
    });
  }
  if (!mode) return NextResponse.json({ error: safeError }, { status: 503 });

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
      userId: user.id,
      assistantId: assistant.id,
      mode,
      requestId,
      usageKind: "research",
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
      weeklyUsageReserved: true,
    });
  }

  // GitHub Read (before web): deterministic intent → one allowlisted github.* Action.
  // Same Cost Guard preflight + Action stream path as web.search. Public repos only.
  const githubDecision = decideGitHubRead(userMessage.content);
  if (githubDecision.use) {
    const weeklyRejected = await rejectWeeklyUsageBeforeStream({
      supabase,
      userId: user.id,
      assistantId: assistant.id,
      mode,
      requestId,
    });
    if (weeklyRejected) return weeklyRejected;
    return createAutoGitHubActionChatResponse({
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
      githubActionId: githubDecision.actionId,
      githubRawInput: githubDecision.input,
      githubRouteReason: githubDecision.reason,
      githubActionTitle: githubDecision.title,
      weeklyUsageReserved: true,
    });
  }
  logInfo("github.route.decided", { requestId, use: false, reason: githubDecision.reason });

  // Automatic Web Search V1 runs through Action Runtime (web.search) — allowlisted, audited, stoppable.
  // Deterministic routing decides; no extra LLM round for the Action decision. Fast path (no search) is unchanged.
  const webDecision = decideWebSearch(userMessage.content, { hasRoomFileContext: Boolean(files?.length) });
  if (webDecision.search) {
    const weeklyRejected = await rejectWeeklyUsageBeforeStream({
      supabase,
      userId: user.id,
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
      weeklyUsageReserved: true,
    });
  }
  logInfo("web.route.decided", { requestId, search: false, reason: webDecision.reason });

  // No-action path: no web sources; chat continues as before Actions V1.
  let web: WebContextInput[] | undefined;
  const preparedCitationSources: SourceReference[] = [];
  let citationSources: SourceReference[] = [];
  let citationViews: ReturnType<typeof citationViewsFromPrepared> = [];
  const webVerificationUnavailable = false;

  const persistence = createGenerationPersistence({
    supabase,
    userId: user.id,
    conversationId: conversation.id,
    assistantId: assistant.id,
    requestId,
    citationSources: () => citationSources,
    onFailure: (status) => {
      logError("chat.persistence.failed", { requestId, code: operationalCodes.assistantPersistFailed, stage: "persist", status });
    },
  });
  const { persist } = persistence;
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

  const lifecycle = createGenerationLifecycle({
    requestSignal: request.signal,
    supabase,
    userId: user.id,
    generationId: assistant.id,
    requestId,
    mode,
    stopStage: "generation",
    durationMs,
  });
  if (lifecycle.clientCancelled) {
    lifecycle.cleanup();
    await persist("Response stopped.", "interrupted");
    return new Response(null, { status: 499 });
  }

  // Reserve weekly credits AND dollar spend after validation/claim/context. Client never sends cost or balance.
  const usageKind: UsageKind = "chat";
  let usageReservationMs = 0;
  let spendReservedMicros = 0;
  const releaseReservation = lifecycle.releaseBeforeStart;
  const gate = await reserveUsageBeforeGeneration({
    supabase,
    userId: user.id,
    generationId: assistant.id,
    mode,
    usageKind,
    requestId,
  });
  if (!gate.ok) {
    try {
      await persist(
        gate.code === operationalCodes.weeklyUsageLimitRejected
          ? "Weekly usage limit reached."
          : gate.code === operationalCodes.aiSpendLimitRejected
            ? "AI spend budget reached."
            : lifecycle.clientCancelled ? "Response stopped." : "Response unavailable.",
        gate.status === 429 ? "error" : lifecycle.clientCancelled ? "interrupted" : "error",
      );
    } finally { lifecycle.cleanup(); }
    if (lifecycle.clientCancelled || request.signal.aborted) return new Response(null, { status: 499 });
    if (gate.status === 429) {
      return NextResponse.json({
        code: gate.code,
        error: gate.error,
        ...(typeof gate.creditsRemaining === "number" ? { creditsRemaining: gate.creditsRemaining } : {}),
        ...(gate.resetAt ? { resetAt: gate.resetAt } : {}),
      }, { status: 429, headers: { "x-request-id": requestId } });
    }
    return NextResponse.json({ error: safeError }, { status: 503 });
  }
  usageReservationMs = gate.usageReservationMs;
  spendReservedMicros = gate.spendReservedMicros;

  if (lifecycle.clientCancelled || request.signal.aborted) {
    try {
      await releaseReservation();
      await persist("Response stopped.", "interrupted");
    } finally { lifecycle.cleanup(); }
    return new Response(null, { status: 499 });
  }

  // Stop is also observed from the row because browser disconnects do not reach request.signal on every host.
  lifecycle.watchForStop();
  lifecycle.startProviderTimeout();
  const providerStartedAt = Date.now();
  const timeoutError = "The provider took too long to finish this response. Please try again.";
  let responseStream: ReadableStream<Uint8Array>;
  try { responseStream = await chatProvider.stream(mode, prompt, lifecycle.signal); }
  catch (error) {
    lifecycle.stopWatching();
    try {
      const interrupted = lifecycle.userStopped || lifecycle.clientCancelled || request.signal.aborted;
      if (interrupted) logWarn("chat.response.interrupted", { requestId, stage: "provider", status: "interrupted", durationMs: durationMs() });
      else logError("chat.response.failed", { requestId, durationMs: durationMs(), ...providerFailureFields(error) });
      if (!interrupted) await releaseReservation();
      if (!lifecycle.userStopped) await persist(lifecycle.clientCancelled ? stoppedPlaceholder : "Response unavailable.", lifecycle.clientCancelled ? "interrupted" : "error");
      return NextResponse.json({ error: lifecycle.providerTimedOut ? timeoutError : safeError }, { status: lifecycle.providerTimedOut ? 504 : 502 });
    } finally { lifecycle.cleanup(); }
  }

  const usageStarted = await lifecycle.startUsage();
  if (!usageStarted) {
    lifecycle.abortProvider();
    try {
      await releaseReservation();
      await persist(lifecycle.clientCancelled ? "Response stopped." : "Response unavailable.", lifecycle.clientCancelled ? "interrupted" : "error");
    } finally { lifecycle.cleanup(); }
    if (lifecycle.clientCancelled || request.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ error: safeError }, { status: 503 });
  }

  // Summary maintenance runs after the response finishes, and only for a reply saved as complete. It is best effort:
  // whatever happens to it, the saved reply stays as it is.
  const summaryMaintenance = deferThreadSummaryMaintenance({ supabase, conversationId: conversation.id, requestId });
  const promptChars = prompt.reduce((sum, message) => sum + message.content.length, 0);
  let costEstimate: GenerationCostEstimate | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const generation = createGenerationStream({
        responseStream, lifecycle, persistence, sources: citationSources,
        requestId, assistantId: assistant.id, providerStartedAt, durationMs,
        path: "ordinary",
        interrupted: () => lifecycle.userStopped || lifecycle.clientCancelled || request.signal.aborted,
        emit: (type, data) => controller.enqueue(encoder.encode(event(type, data))),
        onStart: () => controller.enqueue(encoder.encode(event("start", {
          id: assistant.id, position: assistant.position, context,
          ...(citationViews.length ? { sources: citationViews } : {}),
        }))),
        onComplete: () => summaryMaintenance.complete(assistant.position),
      });
      try {
        await generation.run();
      } finally {
        lifecycle.clearProviderTimeout();
        try {
          costEstimate = withCostEstimate(
            mode,
            generation.providerUsage ?? estimateUsageFromText({ promptChars, outputChars: generation.output.length }),
          );
          await lifecycle.settleSpend(costEstimate.estimatedUsdMicros);
          logGenerationTelemetry({
            requestId,
            logicalMode: mode,
            provider: providerFor(mode),
            model: configuredModelLabel(mode),
            usageKind,
            usage: costEstimate,
            providerTtftMs: generation.providerTtftMs,
            generationDurationMs: Date.now() - providerStartedAt,
            totalDurationMs: Date.now() - requestStartedAt,
            finishReason: generation.finishReason,
            failureCategory: generation.failureCategory,
            streamCompleted: generation.completed,
            outputChars: generation.output.length,
            usageReservationMs,
            spendReservedMicros,
            spendAccepted: true,
          });
        } finally {
          lifecycle.cleanup();
          try { summaryMaintenance.finish(); } catch { /* best effort */ }
          if (!lifecycle.clientCancelled) { controller.enqueue(encoder.encode(event("done", {}))); controller.close(); }
        }
      }
    },
    cancel() { lifecycle.cancel(); },
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
