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
  await settings(page).getByRole("tab", { name, exact: true }).click();
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

test("mobile tabs contain focus and close returns to the menu button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  const menu = page.getByRole("button", { name: "Open conversation menu", exact: true });
  await open(page);
  await expect(settings(page).getByRole("tab", { name: "General", exact: true })).toBeFocused();
  await settings(page).getByRole("button", { name: "Close settings" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(settings(page).getByRole("button", { name: "System theme" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test.describe("mobile section tabs", () => {
  test.use({ isMobile: true, hasTouch: true });

  for (const width of [320, 390]) test(`touch scrolling, keyboard selection and drafts at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview");
    await open(page);
    const navigation = settings(page).getByRole("tablist", { name: "Settings sections" });
    await expect(navigation).toHaveAttribute("aria-orientation", "horizontal");
    await expect(navigation.getByRole("tab")).toHaveCount(7);
    expect((await navigation.boundingBox())!.height).toBeLessThanOrEqual(70);
    expect(await navigation.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

    // A real Chromium touch sequence scrolls the strip without switching sections.
    const touch = await page.context().newCDPSession(page);
    const bounds = (await navigation.boundingBox())!;
    const y = bounds.y + bounds.height / 2;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: width - 30, y }] });
    for (const x of [width - 80, width / 2, 30]) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    // Hold before lifting so release velocity is zero. Otherwise Chromium on Windows
    // can leave a fling active at the scroll edge and swallow the next tap to cancel it.
    await page.waitForTimeout(150);
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 30, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await touch.detach();
    await expect.poll(() => navigation.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(navigation.getByRole("tab", { name: "General", exact: true })).toHaveAttribute("aria-selected", "true");
    await navigation.getByRole("tab", { name: "Data & Privacy", exact: true }).tap();
    await expect(settings(page).getByRole("heading", { name: "Data & Privacy", exact: true })).toBeVisible();

    await navigation.getByRole("tab", { name: "General", exact: true }).focus();
    await page.keyboard.press("End");
    const last = navigation.getByRole("tab", { name: "Data & Privacy", exact: true });
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect(settings(page).getByRole("tabpanel", { name: "Data & Privacy", exact: true })).toBeVisible();
    await expect.poll(() => last.evaluate((element) => {
      const tab = element.getBoundingClientRect();
      const strip = element.parentElement!.getBoundingClientRect();
      return tab.left >= strip.left && tab.right <= strip.right;
    })).toBe(true);
    await page.setViewportSize({ width: 1440, height: 844 });
    await expect(settings(page).getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
    await page.setViewportSize({ width, height: 844 });
    await expect(navigation).toHaveAttribute("aria-orientation", "horizontal");
    await expect.poll(() => last.evaluate((element) => {
      const tab = element.getBoundingClientRect();
      const strip = element.parentElement!.getBoundingClientRect();
      return tab.left >= strip.left && tab.right <= strip.right;
    })).toBe(true);
    await last.focus();
    await page.keyboard.press("ArrowRight");
    await expect(navigation.getByRole("tab", { name: "General", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(last).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect(navigation.getByRole("tab", { name: "AI & Models", exact: true })).toBeFocused();
    await expect(settings(page).getByRole("heading", { name: "AI & Models", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    for (const theme of ["Dark", "Light"]) {
      await select(page, "General");
      await settings(page).getByRole("button", { name: `${theme} theme` }).click();
      await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
      await page.screenshot({ path: info.outputPath(`tabs-${width}-${theme.toLowerCase()}.png`) });
    }
    await select(page, "Personalization");
    await settings(page).getByLabel("Preferred name", { exact: true }).fill("Mobile draft");
    await select(page, "General");
    await select(page, "Personalization");
    await expect(settings(page).getByLabel("Preferred name", { exact: true })).toHaveValue("Mobile draft");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeVisible();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(settings(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open conversation menu", exact: true })).toBeFocused();
  });
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
