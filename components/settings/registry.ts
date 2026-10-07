import { ChatSettingsSection, DataSettingsSection, GeneralSettingsSection, MemorySettingsSection, NibieSettingsSection, PersonalizationSettingsSection, ProfileSettingsSection, type SettingsSectionProps } from "@/components/settings/sections";
import type { ComponentType } from "react";

export type SettingsSectionId = "profile" | "general" | "nibie" | "chat" | "personalization" | "memory" | "data";

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  label: string;
  Component: ComponentType<SettingsSectionProps>;
};

// Later settings work adds a section by replacing its component here. The dialog reads this list.
export const settingsSections: readonly SettingsSectionDefinition[] = [
  { id: "profile", label: "Profile", Component: ProfileSettingsSection },
  { id: "general", label: "General", Component: GeneralSettingsSection },
  { id: "nibie", label: "Nibie", Component: NibieSettingsSection },
  { id: "chat", label: "Chat", Component: ChatSettingsSection },
  { id: "personalization", label: "Personalization", Component: PersonalizationSettingsSection },
  { id: "memory", label: "Memory", Component: MemorySettingsSection },
  { id: "data", label: "Data & Privacy", Component: DataSettingsSection },
];
