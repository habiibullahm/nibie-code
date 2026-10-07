import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function files(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git" || name === ".vitest" || name === ".claude" || name === ".cursor") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, acc);
    else acc.push(path);
  }
  return acc;
}

describe("settings ownership", () => {
  it("keeps one settings opener, one preference store, and foundation migration 0003", () => {
    expect(existsSync(join(root, "components/settings/settings-dialog.tsx"))).toBe(true);
    expect(existsSync(join(root, "components/settings-dialog.tsx"))).toBe(false);
    expect(existsSync(join(root, "lib/preferences.ts"))).toBe(false);
    expect(existsSync(join(root, "lib/preferences/store.ts"))).toBe(true);
    expect(existsSync(join(root, "app/actions/preferences.ts"))).toBe(true);

    const sources = files(root).filter((file) => {
      const normalized = file.replaceAll("\\", "/");
      return (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) && !normalized.includes("/tests/");
    });
    const dialogs = sources.filter((file) => /^export function SettingsDialog/m.test(readFileSync(file, "utf8")));
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].replaceAll("\\", "/")).toContain("components/settings/settings-dialog.tsx");

    const openers = sources.filter((file) => readFileSync(file, "utf8").includes('aria-label="Settings"'));
    expect(openers).toHaveLength(1);
    expect(openers[0].replaceAll("\\", "/")).toContain("components/chat-sidebar.tsx");

    const privacyEntries = sources.filter((file) => {
      const normalized = file.replaceAll("\\", "/");
      // Public docs may name the Data & privacy topic. This guard is for a second in-app settings entry.
      if (normalized.includes("/app/docs/")) return false;
      return /privacy-entry|Data & privacy/.test(readFileSync(file, "utf8"));
    });
    expect(privacyEntries).toEqual([]);

    const migrations = files(join(root, "drizzle")).filter((file) => file.endsWith(".sql") && readFileSync(file, "utf8").includes("user_preferences")).map((file) => file.replaceAll("\\", "/"));
    expect(migrations.some((file) => file.includes("drizzle/0003_user_preferences.sql"))).toBe(true);
    // Later additive columns (for example recall_enabled) may touch user_preferences; foundation stays 0003.
    expect(migrations.every((file) => /drizzle\/00(03_user_preferences|15_memories)\.sql$/.test(file))).toBe(true);
  });
});
