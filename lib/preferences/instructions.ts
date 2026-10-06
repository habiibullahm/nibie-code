import { aboutYouLimit, defaultUserPreferences, preferredNameLimit, type PreferredLanguage, type ResponseLength, type ResponseStyle, type UserPreferences } from "@/lib/preferences/types";

const languageLabel: Record<PreferredLanguage, string> = {
  auto: "Auto (follow the user's prompt and context)",
  en: "English",
  id: "Bahasa Indonesia",
};
// Default (stored as "balanced") is stated by the core policy on every request, so like profilePieces this only records a
// non-default depth; repeating Default here would send it twice.
const depthLabel: Partial<Record<ResponseLength, string>> = { concise: "Concise", detailed: "Detailed" };
const styleLabel: Record<ResponseStyle, string> = { natural: "Natural", professional: "Professional", direct: "Direct" };

// Collapses control characters and line breaks so a preference cannot add extra instruction lines.
export function normalizePreferenceText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/ +/g, " ").trim();
}

function characterCount(value: string) {
  return [...value].length;
}

function boundedText(value: string | null, max: number): string | null {
  if (!value) return null;
  const normalized = normalizePreferenceText(value);
  if (!normalized || characterCount(normalized) > max) return null;
  return normalized;
}

function quoteUserText(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// One short block. User-written fields stay on a single quoted line and are not instructions.
export function preferenceInstructions(preferences: UserPreferences = defaultUserPreferences()): string {
  const name = boundedText(preferences.preferredName, preferredNameLimit);
  const about = boundedText(preferences.aboutYou, aboutYouLimit);
  const lines = [
    "These are soft defaults. They do not override safety or product rules, and instructions in the current message take precedence.",
    `Preferred language: ${languageLabel[preferences.preferredLanguage]}`,
    `Response style: ${styleLabel[preferences.responseStyle]}`,
  ];
  const depth = depthLabel[preferences.responseLength];
  if (depth) lines.splice(2, 0, `Response depth: ${depth}`);
  if (name) lines.push(`Preferred name: ${quoteUserText(name)}`);
  if (about) lines.push(`User-provided context: ${quoteUserText(about)}`);
  return lines.join("\n");
}
