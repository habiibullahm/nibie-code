import { contextPolicyFor, CONTEXT_POLICY_VERSION } from "@/lib/context/context-policy";
import { ContextBuildError, type BuildContextInput, type ContextBlock, type ContextDiagnostics, type ContextPlan, type ContextSourceDiagnostic, type ThreadMessage } from "@/lib/context/context-types";
import { renderAttachmentContext } from "@/lib/context/attachment-context";
import { renderFileContext } from "@/lib/context/file-context";
import { pinPieces, type PinPiece } from "@/lib/context/pin-context";
import { profilePieces, profileReason, type ProfilePiece } from "@/lib/context/profile-context";
import { roomPieces, roomReason, type RoomPiece } from "@/lib/context/room-context";
import { renderThreadSummary, resolveThreadSummary, selectThreadMessages } from "@/lib/context/thread-context";
import { ATTACHMENT_TOKEN_CAP, budgetLimits, estimateTokens, FILE_TOKEN_CAP, PIN_TOKEN_CAP, PROTECTED_RECENT_COUNT, ROOM_TOKEN_CAP, SUMMARY_TOKEN_CAP } from "@/lib/context/token-budget";

function block(partial: ContextBlock): ContextBlock {
  return partial;
}

function takeNewest(messages: ThreadMessage[], remaining: { value: number }) {
  const included: ThreadMessage[] = [];
  const dropped: ThreadMessage[] = [];
  for (const message of [...messages].reverse()) {
    const tokens = estimateTokens(message.content);
    if (tokens <= remaining.value) {
      included.push(message);
      remaining.value -= tokens;
    } else dropped.push(message);
  }
  return { included: included.reverse(), dropped };
}

export function buildContext(input: BuildContextInput): ContextPlan {
  const { contextWindowTokens, maxOutputTokens } = input.capabilities;
  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0 || !Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new ContextBuildError();
  const { inputBudgetTokens, outputReserveTokens } = budgetLimits(input.capabilities);
  if (inputBudgetTokens <= 0) throw new ContextBuildError();

  const selected = selectThreadMessages(input.messages, input.currentPosition);
  const current = selected.find((message) => message.position === input.currentPosition && message.role === "user");
  if (!current) throw new ContextBuildError();
  const earlier = selected.filter((message) => message !== current);
  const protectedCount = Math.max(0, PROTECTED_RECENT_COUNT - 1);
  const protectedMessages = earlier.slice(-protectedCount);
  const olderMessages = earlier.slice(0, earlier.length - protectedMessages.length);
  const resolved = resolveThreadSummary(input.summary, input.currentPosition);
  const pieces = profilePieces(input.preferences);
  const corePolicyText = contextPolicyFor(input.responseMode);
  const coreTokens = estimateTokens(corePolicyText);
  const currentTokens = estimateTokens(current.content);
  if (coreTokens + currentTokens > inputBudgetTokens) throw new ContextBuildError();

  const remaining = { value: inputBudgetTokens - coreTokens - currentTokens };
  const protectedFit = takeNewest(protectedMessages, remaining);
  const includedPieces: ProfilePiece[] = [];
  const droppedPieces: ProfilePiece[] = [];
  for (const piece of pieces) {
    const tokens = estimateTokens(piece.text);
    if (tokens <= remaining.value) {
      includedPieces.push(piece);
      remaining.value -= tokens;
    } else droppedPieces.push(piece);
  }

  const hasRoom = input.room != null;
  const roomCandidates = hasRoom ? roomPieces(input.room) : [];
  const includedRoom: RoomPiece[] = [];
  const droppedRoom: RoomPiece[] = [];
  let roomAllowance = Math.min(ROOM_TOKEN_CAP, remaining.value);
  for (const piece of roomCandidates) {
    const tokens = estimateTokens(piece.text);
    if (tokens <= roomAllowance) {
      includedRoom.push(piece);
      roomAllowance -= tokens;
      remaining.value -= tokens;
    } else droppedRoom.push(piece);
  }

  // Newest updated pin first. A pin that does not fit is skipped whole; later pins may still fit.
  const pinCandidates = hasRoom ? pinPieces(input.room?.pins) : [];
  const includedPins: PinPiece[] = [];
  const droppedPins: PinPiece[] = [];
  let pinAllowance = Math.min(PIN_TOKEN_CAP, remaining.value);
  for (const piece of pinCandidates) {
    const tokens = estimateTokens(piece.text);
    if (tokens <= pinAllowance) {
      includedPins.push(piece);
      pinAllowance -= tokens;
      remaining.value -= tokens;
    } else droppedPins.push(piece);
  }

  // Explicitly selected files only. They sit after pins and never become a search over the room.
  const requestedFiles = input.files?.length ? input.files : null;
  const renderedFiles = requestedFiles ? renderFileContext(requestedFiles, Math.min(FILE_TOKEN_CAP, remaining.value)) : null;
  if (renderedFiles?.text) remaining.value -= estimateTokens(renderedFiles.text);

  // Chat attachments of this conversation: after room context and room files, before the summary and older history.
  const requestedAttachments = input.attachments?.length ? input.attachments : null;
  const renderedAttachments = requestedAttachments ? renderAttachmentContext(requestedAttachments, Math.min(ATTACHMENT_TOKEN_CAP, remaining.value)) : null;
  if (renderedAttachments?.text) remaining.value -= estimateTokens(renderedAttachments.text);

  let summaryText = "";
  let summaryIncluded = false;
  let summaryDroppedForBudget = false;
  const summary = resolved.summary;
  if (summary) {
    const text = renderThreadSummary(summary);
    const tokens = estimateTokens(text);
    if (tokens <= SUMMARY_TOKEN_CAP && tokens <= remaining.value) {
      summaryText = text;
      summaryIncluded = true;
      remaining.value -= tokens;
    } else summaryDroppedForBudget = true;
  }
  const olderFit = summaryIncluded ? { included: [] as ThreadMessage[], dropped: olderMessages } : takeNewest(olderMessages, remaining);
  const dialogue = [...olderFit.included, ...protectedFit.included, current];
  const droppedMessages = summaryIncluded ? protectedFit.dropped : [...olderFit.dropped, ...protectedFit.dropped];
  const truncated = droppedMessages.length > 0 || droppedPieces.length > 0 || droppedRoom.length > 0 || droppedPins.length > 0 || Boolean(renderedFiles?.truncated) || Boolean(renderedAttachments?.truncated) || summaryDroppedForBudget;

  const profileText = includedPieces.map((piece) => piece.text).join("\n");
  const roomText = includedRoom.map((piece) => piece.text).join("\n\n");
  const pinText = includedPins.map((piece) => piece.text).join("\n\n");
  const fileText = renderedFiles?.text ?? "";
  const attachmentText = renderedAttachments?.text ?? "";
  const blocks: ContextBlock[] = [
    block({ id: "core", authority: "policy", priority: 1, required: true, text: corePolicyText, tokenEstimate: coreTokens, included: true, exclusionReason: null }),
    block({ id: "profile", authority: "untrusted_data", priority: 4, required: false, text: profileText, tokenEstimate: profileText ? estimateTokens(profileText) : 0, included: Boolean(profileText), exclusionReason: profileText ? null : input.preferenceReadFailed ? "read_failed" : droppedPieces.length && !includedPieces.length ? "budget" : "defaults_only" }),
  ];
  if (hasRoom) {
    blocks.push(block({ id: "room", authority: "untrusted_data", priority: 5, required: false, text: roomText, tokenEstimate: roomText ? estimateTokens(roomText) : 0, included: Boolean(roomText), exclusionReason: roomText ? null : droppedRoom.length ? "budget" : "not_needed" }));
    blocks.push(block({ id: "pins", authority: "untrusted_data", priority: 5, required: false, text: pinText, tokenEstimate: pinText ? estimateTokens(pinText) : 0, included: Boolean(pinText), exclusionReason: pinText ? null : droppedPins.length ? "budget" : "not_needed" }));
  }
  if (requestedFiles) {
    blocks.push(block({ id: "file", authority: "untrusted_data", priority: 6, required: false, text: fileText, tokenEstimate: fileText ? estimateTokens(fileText) : 0, included: Boolean(fileText), exclusionReason: fileText ? null : "budget" }));
  }
  if (requestedAttachments) {
    blocks.push(block({ id: "attachment", authority: "untrusted_data", priority: 6, required: false, text: attachmentText, tokenEstimate: attachmentText ? estimateTokens(attachmentText) : 0, included: Boolean(attachmentText), exclusionReason: attachmentText ? null : "budget" }));
  }
  blocks.push(block({ id: "thread_summary", authority: "untrusted_data", priority: 6, required: false, text: summaryText, tokenEstimate: summaryText ? estimateTokens(summaryText) : 0, included: summaryIncluded, exclusionReason: summaryIncluded ? null : summaryDroppedForBudget ? "budget" : resolved.exclusionReason }));
  for (const message of dialogue) {
    const isCurrent = message === current;
    blocks.push(block({
      id: isCurrent ? "current_request" : "recent_messages",
      authority: "untrusted_data",
      priority: isCurrent ? 3 : 7,
      required: isCurrent,
      text: message.content,
      tokenEstimate: estimateTokens(message.content),
      included: true,
      exclusionReason: null,
      dialogueRole: message.role,
    }));
  }

  const profileDiagnostic: ContextSourceDiagnostic = profileText
    ? { type: "profile", label: "Your profile", state: "included", reason: profileReason(includedPieces.flatMap((piece) => piece.categories)) }
    : { type: "profile", label: "Your profile", state: "not_used", reason: input.preferenceReadFailed ? "Preferences couldn't be loaded, so Nibie used defaults." : "No extra profile details are set." };
  const earlierIncluded = dialogue.length - 1;
  const recentDiagnostic: ContextSourceDiagnostic = earlierIncluded > 0 || droppedMessages.length > 0
    ? { type: "recent_messages", label: "Recent conversation", state: earlierIncluded > 0 ? "included" : "not_used", reason: droppedMessages.length ? "Older messages left out so this reply stays focused." : "The latest messages in this thread." }
    : { type: "recent_messages", label: "Recent conversation", state: "not_used", reason: "No earlier messages yet." };
  const summaryDiagnostic: ContextSourceDiagnostic = summaryIncluded
    ? { type: "thread_summary", label: "Thread summary", state: "included", reason: "Older parts of this conversation." }
    : { type: "thread_summary", label: "Thread summary", state: "not_used", reason: summaryDroppedForBudget ? "Not used for this reply." : "Not needed yet." };
  const roomDiagnostic: ContextSourceDiagnostic | null = hasRoom
    ? roomText
      ? { type: "room", label: "This room", state: "included", reason: roomReason(includedRoom.flatMap((piece) => piece.categories)) }
      : { type: "room", label: "This room", state: "not_used", reason: droppedRoom.length ? "Not used for this reply." : "No room instructions or brief are set." }
    : null;
  const pinsDiagnostic: ContextSourceDiagnostic | null = hasRoom
    ? pinText
      ? { type: "pins", label: "Pinned context", state: "included", reason: "This room" }
      : { type: "pins", label: "Pinned context", state: "not_used", reason: droppedPins.length ? "Not used for this reply." : "No pins in this room." }
    : null;
  const fileDiagnostic: ContextSourceDiagnostic | null = requestedFiles
    ? fileText
      ? { type: "file", label: "File context", state: "included", reason: requestedFiles.length === 1 ? "Selected room file" : "Selected room files" }
      : { type: "file", label: "File context", state: "not_used", reason: "Not used for this reply." }
    : null;

  const attachmentDiagnostic: ContextSourceDiagnostic | null = requestedAttachments
    ? renderedAttachments?.includedCount
      ? { type: "attachment", label: "Attachments", state: "included", reason: renderedAttachments.truncated ? "Partly included: some file text did not fit this reply." : requestedAttachments.length === 1 ? "A file attached in this conversation" : "Files attached in this conversation" }
      : { type: "attachment", label: "Attachments", state: "not_used", reason: "Not used for this reply." }
    : null;

  let diagnostics: ContextDiagnostics;
  try {
    const sources = [profileDiagnostic, recentDiagnostic, summaryDiagnostic];
    if (roomDiagnostic) sources.splice(1, 0, roomDiagnostic);
    if (pinsDiagnostic) sources.splice(roomDiagnostic ? 2 : 1, 0, pinsDiagnostic);
    if (fileDiagnostic) {
      const pinsIndex = sources.findIndex((source) => source.type === "pins");
      const roomIndex = sources.findIndex((source) => source.type === "room");
      const insertAt = pinsIndex >= 0 ? pinsIndex + 1 : roomIndex >= 0 ? roomIndex + 1 : 1;
      sources.splice(insertAt, 0, fileDiagnostic);
    }
    if (attachmentDiagnostic) sources.splice(sources.findIndex((source) => source.type === "recent_messages"), 0, attachmentDiagnostic);
    diagnostics = { sources, recentMessageCount: dialogue.length };
  } catch {
    diagnostics = { sources: [], recentMessageCount: dialogue.length };
  }

  const estimatedTokens = blocks.filter((item) => item.included).reduce((sum, item) => sum + item.tokenEstimate, 0);
  return {
    policyVersion: CONTEXT_POLICY_VERSION,
    blocks,
    diagnostics,
    budget: { inputBudgetTokens, outputReserveTokens, estimatedTokens, truncated },
  };
}
