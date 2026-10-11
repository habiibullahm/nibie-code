"use client";

import { DataPrivacyPanel } from "@/components/data-privacy-dialog";
import { WeeklyUsageSummary } from "@/components/settings/weekly-usage-summary";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useChatFlag } from "@/components/use-chat-preferences";
import { SettingsChoice, SettingsSection, SettingsTextField, SettingsToggle } from "@/components/settings/settings-section";
import { modelPickerCopy, type ModelOption } from "@/lib/chat/models";
import type { ChatPreferenceFlag } from "@/lib/chat/preferences";
import { chatModelToPreferenceModel, preferenceModelToChatModel, resolveDefaultModel } from "@/lib/preferences/model";
import { aboutYouLimit, preferredNameLimit, type PreferencePatch, type UserPreferences } from "@/lib/preferences/types";

export type SettingsSectionProps = {
  preferences: UserPreferences;
  models: ModelOption[];
  email?: string;
  disabled: boolean;
  preview?: boolean;
  busy?: boolean;
  onChange: (patch: PreferencePatch) => void;
  onConversationsDeleted?: () => void;
};

const languageOptions = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "id", label: "Bahasa Indonesia" },
] as const;

// "balanced" stays the stored value; Default is its product name.
const depthOptions = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Default" },
  { value: "detailed", label: "Detailed" },
] as const;

const styleOptions = [
  { value: "natural", label: "Natural" },
  { value: "professional", label: "Professional" },
  { value: "direct", label: "Direct" },
] as const;

export function GeneralSettingsSection({ preferences, disabled, onChange }: SettingsSectionProps) {
  return <SettingsSection title="General" description="Appearance on this device and the language Nibie should prefer.">
    <SettingsChoice label="Preferred language" hint="Auto follows the language you are using. English and Bahasa Indonesia are saved on your account." value={preferences.preferredLanguage} options={[...languageOptions]} disabled={disabled} onChange={(preferredLanguage) => onChange({ preferredLanguage })} />
    <div className="settings-theme">
      <div className="settings-theme-label">Theme</div>
      <p>Dark, light, or match this device. Stored on this device.</p>
      <ThemeSwitcher showLabels />
    </div>
  </SettingsSection>;
}

export function AISettingsSection({ preferences, models, disabled, onChange }: SettingsSectionProps) {
  const available = models.map((option) => option.id);
  const options = models.map((option) => ({ value: chatModelToPreferenceModel[option.id], label: modelPickerCopy[option.id].label }));
  const storedMode = preferenceModelToChatModel[preferences.defaultModel];
  const storedIsAvailable = available.includes(storedMode);
  const fallback = resolveDefaultModel(preferences.defaultModel, available);
  const hint = !options.length ? "No models are configured. Your saved default is kept until a model is available." : storedIsAvailable || !fallback
    ? "Used for new chats and new Room threads. Existing conversations keep their own model; you can change it in the composer."
    : `${modelPickerCopy[storedMode].label} isn't available, so new chats use ${modelPickerCopy[fallback].label}. Conversations you already have keep their own model.`;
  return <SettingsSection title="AI & Models" description="Defaults for new conversations. They do not change a chat you already started.">
    <SettingsChoice label="Default model" hint={hint} value={preferences.defaultModel} options={options} disabled={disabled || options.length === 0} onChange={(defaultModel) => onChange({ defaultModel })} />
    <SettingsChoice label="Response depth" hint="Default fully answers the task without padding. A request in your message, like “in one sentence”, still wins." value={preferences.responseLength} options={[...depthOptions]} disabled={disabled} onChange={(responseLength) => onChange({ responseLength })} />
    <SettingsChoice label="Response style" value={preferences.responseStyle} options={[...styleOptions]} disabled={disabled} onChange={(responseStyle) => onChange({ responseStyle })} />
  </SettingsSection>;
}

const chatRows: { flag: ChatPreferenceFlag; label: string; on: string; off: string }[] = [
  { flag: "enterToSend", label: "Enter to send", on: "Enter sends. Shift+Enter starts a new line.", off: "Enter starts a new line. Ctrl+Enter or ⌘+Enter sends." },
  { flag: "autoFollow", label: "Auto-follow streaming", on: "Stay with new messages while you’re near the bottom.", off: "Streaming and sending leave your place in the transcript." },
  { flag: "showTimestamps", label: "Show timestamps", on: "Each message shows a short time.", off: "Times stay hidden." },
  { flag: "restoreLastChat", label: "Restore last conversation", on: "Returning opens your last chat. A missing chat starts a new one.", off: "Nibie opens a new chat." },
];

function ChatSetting({ flag, label, on, off }: { flag: ChatPreferenceFlag; label: string; on: string; off: string }) {
  const [enabled, setEnabled] = useChatFlag(flag);
  return <SettingsToggle label={label} hint={enabled ? on : off} checked={enabled} onChange={setEnabled} />;
}

export function ChatSettingsSection() {
  return <SettingsSection title="Chat" description="How composing and reading a conversation behaves on this device. These choices stay on this device.">
    <div className="chat-settings">{chatRows.map((row) => <ChatSetting key={row.flag} {...row} />)}</div>
  </SettingsSection>;
}

export function PersonalizationSettingsSection({ preferences, email = "", disabled, onChange }: SettingsSectionProps) {
  return <SettingsSection title="Personalization" description="Optional details to tailor responses. Save each field when you’re ready.">
    <SettingsTextField id="preferred-name" label="Preferred name" hint="Leave blank to use the name from your sign-in." value={preferences.preferredName ?? ""} maxLength={preferredNameLimit} disabled={disabled} onCommit={(preferredName) => onChange({ preferredName })} />
    <SettingsTextField id="about-you" label="About you" hint="Role, goals, or working context. Leave blank to clear it." value={preferences.aboutYou ?? ""} maxLength={aboutYouLimit} multiline disabled={disabled} onCommit={(aboutYou) => onChange({ aboutYou })} />
    <div className="settings-field"><div className="settings-theme-label">Email</div><p className="settings-note">{email}</p></div>
  </SettingsSection>;
}

export function UsageSettingsSection({ preview = false }: SettingsSectionProps) {
  return <SettingsSection title="Usage & Plan" description="Your current weekly allowance and when it resets.">
    <div className="weekly-usage">
      <h3>Free plan</h3>
      <p className="settings-note">Free usage resets weekly. There’s no paid plan or billing yet.</p>
      <WeeklyUsageSummary preview={preview} />
    </div>
  </SettingsSection>;
}

export function DataSettingsSection({ preview = false, busy = false, onConversationsDeleted }: SettingsSectionProps) {
  return <SettingsSection title="Data & Privacy" description="Your conversations belong to your account. Export and deletion stay limited to that account.">
    <DataPrivacyPanel preview={preview} busy={busy} onDeleted={() => onConversationsDeleted?.()} />
  </SettingsSection>;
}
