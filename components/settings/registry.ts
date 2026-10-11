import { AISettingsSection, ChatSettingsSection, DataSettingsSection, GeneralSettingsSection, PersonalizationSettingsSection, UsageSettingsSection, type SettingsSectionProps } from "@/components/settings/sections";
import { MemorySettingsSection } from "@/components/settings/memory-settings-section";
import type { ComponentType } from "react";

export type SettingsSectionId = "general" | "ai" | "chat" | "personalization" | "memory" | "usage" | "data";

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  label: string;
  Component: ComponentType<SettingsSectionProps>;
};

export const settingsSections: readonly SettingsSectionDefinition[] = [
  { id: "general", label: "General", Component: GeneralSettingsSection },
  { id: "ai", label: "AI & Models", Component: AISettingsSection },
  { id: "chat", label: "Chat", Component: ChatSettingsSection },
  { id: "personalization", label: "Personalization", Component: PersonalizationSettingsSection },
  { id: "memory", label: "Memory & Context", Component: MemorySettingsSection },
  { id: "usage", label: "Usage & Plan", Component: UsageSettingsSection },
  { id: "data", label: "Data & Privacy", Component: DataSettingsSection },
];
