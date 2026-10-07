import type { ContextDiagnostics, ContextSourceDiagnostic } from "@/lib/context/context-types";
import { pinPieces } from "@/lib/context/pin-context";
import { roomPieces, roomReason, type RoomContextInput } from "@/lib/context/room-context";
import { aboutYouLimit, preferredNameLimit, type UserPreferences } from "@/lib/preferences/types";
import { normalizePreferenceText } from "@/lib/preferences/instructions";

export type ProfileCategory = "Language" | "Depth" | "Style" | "Name" | "About you";

export type ProfilePiece = {
  kind: "preferences" | "name" | "about";
  categories: ProfileCategory[];
  text: string;
};

const languageLine = { en: "Preferred language: English", id: "Preferred language: Bahasa Indonesia" } as const;
// The core policy states what each depth means for every request (responseDepthInstruction); the profile only records a
// non-default choice so the context panel lists it. Default (stored as "balanced") is a product default and adds nothing here.
const depthLine = { concise: "Response depth: Concise", detailed: "Response depth: Detailed" } as const;
const styleLine = { professional: "Response style: Professional", direct: "Response style: Direct" } as const;

function boundedText(value: string | null, max: number) {
  if (!value) return null;
  const normalized = normalizePreferenceText(value);
  if (!normalized || [...normalized].length > max) return null;
  return normalized;
}

function quoteUserText(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function profilePieces(preferences: UserPreferences): ProfilePiece[] {
  const pieces: ProfilePiece[] = [];
  const lines: string[] = [];
  const categories: ProfileCategory[] = [];
  if (preferences.preferredLanguage === "en" || preferences.preferredLanguage === "id") {
    lines.push(languageLine[preferences.preferredLanguage]);
    categories.push("Language");
  }
  if (preferences.responseLength === "concise" || preferences.responseLength === "detailed") {
    lines.push(depthLine[preferences.responseLength]);
    categories.push("Depth");
  }
  if (preferences.responseStyle === "professional" || preferences.responseStyle === "direct") {
    lines.push(styleLine[preferences.responseStyle]);
    categories.push("Style");
  }
  if (lines.length) pieces.push({ kind: "preferences", categories, text: lines.join("\n") });
  const name = boundedText(preferences.preferredName, preferredNameLimit);
  if (name) pieces.push({ kind: "name", categories: ["Name"], text: `Preferred name: ${quoteUserText(name)}` });
  const about = boundedText(preferences.aboutYou, aboutYouLimit);
  if (about) pieces.push({ kind: "about", categories: ["About you"], text: `User-provided context: ${quoteUserText(about)}` });
  return pieces;
}

export function profileReason(categories: ProfileCategory[]) {
  const words = categories.map((category, index) => index === 0 || category === "About you" ? category : category.toLowerCase());
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

const summaryUnused: ContextSourceDiagnostic = { type: "thread_summary", label: "Thread summary", state: "not_used", reason: "Not needed yet." };

// Preview cannot know whether this turn will search the web, so web diagnostics appear only on the reply start event.
export function previewContextDiagnostics(input: { preferences: UserPreferences; preferenceReadFailed: boolean; hasEarlierMessages: boolean; room?: RoomContextInput | null; selectedFileCount?: number }): ContextDiagnostics {
  const pieces = input.preferenceReadFailed ? [] : profilePieces(input.preferences);
  const profile: ContextSourceDiagnostic = pieces.length
    ? { type: "profile", label: "Your profile", state: "included", reason: profileReason(pieces.flatMap((piece) => piece.categories)) }
    : { type: "profile", label: "Your profile", state: "not_used", reason: input.preferenceReadFailed ? "Preferences couldn't be loaded, so Nibie used defaults." : "No extra profile details are set." };
  const recent: ContextSourceDiagnostic = input.hasEarlierMessages
    ? { type: "recent_messages", label: "Recent conversation", state: "included", reason: "The latest messages in this thread." }
    : { type: "recent_messages", label: "Recent conversation", state: "not_used", reason: "No earlier messages yet." };
  const sources: ContextSourceDiagnostic[] = [profile, recent, summaryUnused];
  if (input.room) {
    const roomParts = roomPieces(input.room);
    sources.splice(1, 0, roomParts.length
      ? { type: "room", label: "This room", state: "included", reason: roomReason(roomParts.flatMap((piece) => piece.categories)) }
      : { type: "room", label: "This room", state: "not_used", reason: "No room instructions or brief are set." });
    const pins = pinPieces(input.room.pins);
    sources.splice(2, 0, pins.length
      ? { type: "pins", label: "Pinned context", state: "included", reason: "This room" }
      : { type: "pins", label: "Pinned context", state: "not_used", reason: "No pins in this room." });
  }
  if (input.selectedFileCount) {
    const pinsIndex = sources.findIndex((source) => source.type === "pins");
    const roomIndex = sources.findIndex((source) => source.type === "room");
    const insertAt = pinsIndex >= 0 ? pinsIndex + 1 : roomIndex >= 0 ? roomIndex + 1 : 1;
    sources.splice(insertAt, 0, {
      type: "file",
      label: "File context",
      state: "included",
      reason: input.selectedFileCount === 1 ? "Selected room file" : "Selected room files",
    });
  }
  return { sources, recentMessageCount: input.hasEarlierMessages ? 1 : 0 };
}
