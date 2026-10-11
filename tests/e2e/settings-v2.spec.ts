import { expect, test, type Page } from "@playwright/test";

const sections = ["General", "AI & Models", "Chat", "Personalization", "Memory & Context", "Usage & Plan", "Data & Privacy"];
const settings = (page: Page) => page.getByRole("dialog", { name: "Settings", exact: true });

async function open(page: Page) {
  const button = page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true });
  if (!await button.count()) await page.getByRole("button", { name: "Open conversation menu" }).click();
  await button.click();
  await expect(settings(page)).toBeVisible();
}

async function select(page: Page, name: string) {
  const picker = settings(page).getByRole("button", { name: /^Settings section:/ });
  if (await picker.isVisible()) {
    await picker.click();
    await settings(page).getByRole("navigation", { name: "Section", exact: true }).getByRole("button", { name, exact: true }).click();
  }
  else await settings(page).getByRole("tab", { name, exact: true }).click();
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`all sections fit and scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview");
    await open(page);
    for (const name of sections) {
      await select(page, name);
      await expect(settings(page).getByRole("heading", { name, exact: true })).toBeVisible();
      const dimensions = await settings(page).evaluate((element) => {
        const content = element.querySelector(".settings-content")!;
        const rect = element.getBoundingClientRect();
        return { width: rect.width, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: content.scrollWidth > content.clientWidth };
      });
      expect(dimensions.overflow).toBe(false);
      expect(dimensions.left).toBeGreaterThanOrEqual(0);
      expect(dimensions.right).toBeLessThanOrEqual(width);
      expect(dimensions.top).toBeGreaterThanOrEqual(0);
      expect(dimensions.bottom).toBeLessThanOrEqual(844);
      if (width < 641) expect(dimensions.width).toBe(width);
      if (width >= 1024) expect(dimensions.width).toBe(800);
    }
    await settings(page).getByRole("heading", { name: "Delete account", exact: true }).scrollIntoViewIfNeeded();
    await expect(settings(page).getByRole("heading", { name: "Delete account", exact: true })).toBeVisible();
    await expect(settings(page).getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
    await expect(settings(page).getByRole("button", { name: "Delete all conversations", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("keyboard navigation, radio choices, focus containment, Escape and focus return", async ({ page }) => {
  await page.goto("/preview");
  const opener = page.getByRole("button", { name: "Settings", exact: true });
  await open(page);
  await expect(settings(page).getByRole("tab", { name: "General", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(settings(page).getByRole("tab", { name: "AI & Models", exact: true })).toBeFocused();
  const depth = settings(page).getByRole("radiogroup", { name: "Response depth" });
  await depth.getByRole("radio", { name: "Default", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(depth.getByRole("radio", { name: "Detailed", exact: true })).toBeChecked();
  await settings(page).getByRole("tab", { name: "AI & Models", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(settings(page).getByRole("tab", { name: "Data & Privacy", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(settings(page).getByRole("tab", { name: "General", exact: true })).toBeFocused();
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    expect(await settings(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  await open(page);
  await page.mouse.click(5, 5);
  await expect(settings(page)).toHaveCount(0);
});

test("theme choices retain their device key and System follows the device after closing", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/preview");
  await open(page);
  for (const theme of ["Light", "Dark", "System"]) {
    await settings(page).getByRole("button", { name: `${theme} theme` }).click();
    await expect(settings(page).getByRole("button", { name: `${theme} theme` })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("nibie-theme"))).toBe(theme.toLowerCase());
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "Dark" ? "dark" : "light");
  }
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await open(page);
  await expect(settings(page).getByRole("button", { name: "System theme" })).toHaveAttribute("aria-pressed", "true");
});

test("name and About you save deliberately, and device switches remain local", async ({ page }) => {
  await page.goto("/preview");
  await open(page);
  await select(page, "Personalization");
  await settings(page).getByLabel("Preferred name", { exact: true }).fill("Settings reviewer");
  await settings(page).getByRole("button", { name: "Save Preferred name" }).click();
  await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
  await settings(page).getByLabel("About you", { exact: true }).fill("I build accessible interfaces.");
  await settings(page).getByRole("button", { name: "Save About you" }).click();
  await select(page, "General");
  await select(page, "Personalization");
  await expect(settings(page).getByLabel("Preferred name", { exact: true })).toHaveValue("Settings reviewer");
  await expect(settings(page).getByLabel("About you", { exact: true })).toHaveValue("I build accessible interfaces.");
  await select(page, "Chat");
  await settings(page).getByRole("switch", { name: "Restore last conversation" }).click();
  expect(await page.evaluate(() => localStorage.getItem("nibie-restore-last-chat"))).toBe("on");
});

test("malformed or unavailable device storage does not break Settings", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage unavailable"); } });
  });
  await page.goto("/preview");
  await open(page);
  await settings(page).getByRole("button", { name: "Light theme" }).click();
  await select(page, "Chat");
  await settings(page).getByRole("switch", { name: "Show timestamps" }).click();
  await select(page, "Memory & Context");
  await expect(settings(page).getByRole("switch", { name: "Use saved memories" })).toBeEnabled();
  await expect(settings(page).getByText("No saved memories yet.", { exact: false })).toBeVisible();
});

test("mobile section selector contains focus and close returns to the menu button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  const menu = page.getByRole("button", { name: "Open conversation menu", exact: true });
  await open(page);
  await expect(settings(page).getByRole("button", { name: /^Settings section:/ })).toBeFocused();
  await settings(page).getByRole("button", { name: "Close settings" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(settings(page).getByRole("button", { name: "System theme" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test("mobile picker is compact, keyboard operable and Escape closes only the picker", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/preview");
  await open(page);
  const picker = settings(page).getByRole("button", { name: /^Settings section:/ });
  await page.keyboard.press("ArrowDown");
  const navigation = settings(page).getByRole("navigation", { name: "Section", exact: true });
  await expect(navigation.getByRole("button", { name: "General", exact: true })).toBeFocused();
  const bounds = await navigation.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(200);
  expect(await navigation.evaluate((element) => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("End");
  await expect(navigation.getByRole("button", { name: "Data & Privacy", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(settings(page).getByRole("heading", { name: "AI & Models", exact: true })).toBeVisible();
  await expect(picker).toBeFocused();
  await picker.click();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(picker).toBeFocused();
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
});

test("both drafts survive section switches and every close path requires a deliberate discard", async ({ page }) => {
  await page.goto("/preview");
  await open(page);
  await select(page, "Personalization");
  await settings(page).getByLabel("Preferred name", { exact: true }).fill("Unsaved name");
  await settings(page).getByLabel("About you", { exact: true }).fill("Unsaved context");
  await select(page, "Memory & Context");
  await select(page, "General");
  for (const close of ["Escape", "Close", "Outside"]) {
    if (close === "Escape") await page.keyboard.press("Escape");
    else if (close === "Close") await settings(page).getByRole("button", { name: "Close settings" }).click();
    else await page.mouse.click(5, 5);
    const confirmation = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirmation.getByRole("button", { name: "Discard changes" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirmation.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await select(page, "Personalization");
    await expect(settings(page).getByLabel("Preferred name", { exact: true })).toHaveValue("Unsaved name");
    await expect(settings(page).getByLabel("About you", { exact: true })).toHaveValue("Unsaved context");
    await select(page, "General");
  }
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes" }).click();
  await expect(settings(page)).toHaveCount(0);
  await open(page);
  await select(page, "Personalization");
  await expect(settings(page).getByLabel("Preferred name", { exact: true })).not.toHaveValue("Unsaved name");
  await expect(settings(page).getByLabel("About you", { exact: true })).not.toHaveValue("Unsaved context");
  await settings(page).getByLabel("Preferred name", { exact: true }).fill("Saved name");
  await settings(page).getByRole("button", { name: "Save Preferred name" }).click();
  await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
  await settings(page).getByLabel("About you", { exact: true }).fill("Saved context");
  await settings(page).getByRole("button", { name: "Save About you" }).click();
  await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
