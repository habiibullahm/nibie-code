import { aboutYouLimit, defaultUserPreferences, preferredNameLimit, type PreferredLanguage, type ResponseLength, type ResponseStyle, type UserPreferences } from "@/lib/preferences/types";

const languageLabel: Record<PreferredLanguage, string> = {
  auto: "Auto (follow the user's prompt and context)",
  en: "English",
  id: "Bahasa Indonesia",
};
// "balanced" is the stored value for Complete; the label is the product name.
const depthLabel: Record<ResponseLength, string> = { concise: "Concise", balanced: "Complete", detailed: "Detailed" };
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
    `Response depth: ${depthLabel[preferences.responseLength]}`,
    `Response style: ${styleLabel[preferences.responseStyle]}`,
  ];
  if (name) lines.push(`Preferred name: ${quoteUserText(name)}`);
  if (about) lines.push(`User-provided context: ${quoteUserText(about)}`);
  return lines.join("\n");
}
