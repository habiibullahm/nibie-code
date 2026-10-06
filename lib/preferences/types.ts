export const preferredLanguages = ["auto", "en", "id"] as const;
export const preferenceModels = ["fast", "balanced", "reasoning"] as const;
// Persisted values. "balanced" is shown as Default, the standard depth; it keeps its stored name for compatibility.
export const responseLengths = ["concise", "balanced", "detailed"] as const;
export const responseStyles = ["natural", "professional", "direct"] as const;

export type PreferredLanguage = (typeof preferredLanguages)[number];
export type PreferenceModel = (typeof preferenceModels)[number];
export type ResponseLength = (typeof responseLengths)[number];
export type ResponseStyle = (typeof responseStyles)[number];

export const preferredNameLimit = 80;
export const aboutYouLimit = 1500;

export type UserPreferences = {
  preferredName: string | null;
  preferredLanguage: PreferredLanguage;
  defaultModel: PreferenceModel;
  responseLength: ResponseLength;
  responseStyle: ResponseStyle;
  aboutYou: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PreferencePatch = Partial<Pick<UserPreferences, "preferredName" | "preferredLanguage" | "defaultModel" | "responseLength" | "responseStyle" | "aboutYou">>;

export function defaultUserPreferences(): UserPreferences {
  return {
    preferredName: null,
    preferredLanguage: "auto",
    defaultModel: "balanced",
    responseLength: "balanced",
    responseStyle: "natural",
    aboutYou: null,
    createdAt: null,
    updatedAt: null,
  };
}
