import { expect, test } from "./qa-fixture";
import type { Page } from "@playwright/test";

const settings = (page: Page) => page.getByRole("dialog", { name: "Settings", exact: true });
const sections = ["General", "AI & Models", "Chat", "Personalization", "Memory & Context", "Usage & Plan", "Data & Privacy"];

async function open(page: Page) {
  const button = page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true });
  if (!await button.count()) await page.getByRole("button", { name: "Open conversation menu" }).click();
  await button.click();
  await expect(settings(page).locator(".settings-status")).not.toHaveText("Loading settings…");
  await expect(settings(page).locator(".settings-error")).toHaveCount(0);
}

async function select(page: Page, name: string) {
  const picker = settings(page).getByRole("button", { name: /^Settings section:/ });
  if (await picker.isVisible()) {
    await picker.click();
    await settings(page).getByRole("navigation", { name: "Section", exact: true }).getByRole("button", { name, exact: true }).click();
  } else await settings(page).getByRole("tab", { name, exact: true }).click();
}

test.beforeEach(async ({ qaPage }) => {
  // This suite never sends a chat or makes a paid provider request.
  await qaPage.route("**/api/chat", (route) => route.abort());
  await qaPage.route("**/api/chat/**", (route) => route.abort());
});

test("signed-in drafts survive navigation and Escape/Close, with explicit discard", async ({ qaPage: page }) => {
  await open(page);
  await select(page, "Personalization");
  const name = settings(page).getByLabel("Preferred name", { exact: true });
  const about = settings(page).getByLabel("About you", { exact: true });
  const savedName = await name.inputValue();
  const savedAbout = await about.inputValue();
  await name.fill(`${savedName} unsaved QA`.slice(0, 75));
  await about.fill(`${savedAbout} unsaved QA context`.slice(0, 1900));
  const draftName = await name.inputValue();
  const draftAbout = await about.inputValue();
  await select(page, "Memory & Context");
  await page.keyboard.press("Escape");
  const confirmation = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Keep editing" }).click();
  await select(page, "Personalization");
  await expect(name).toHaveValue(draftName);
  await expect(about).toHaveValue(draftAbout);
  await settings(page).getByRole("button", { name: "Close settings" }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Discard changes" }).click();
  await expect(settings(page)).toHaveCount(0);
  await open(page);
  await select(page, "Personalization");
  await expect(name).toHaveValue(savedName);
  await expect(about).toHaveValue(savedAbout);
});

test("two asynchronous keyboard saves retain radio focus and subsequent navigation", async ({ qaPage: page }) => {
  test.setTimeout(90_000);
  await open(page);
  await select(page, "AI & Models");
  const group = settings(page).getByRole("radiogroup", { name: "Response depth" });
  const radios = group.getByRole("radio");
  const original = await group.getByRole("radio", { checked: true }).textContent();
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  let requests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] && request.postData()?.includes("responseLength")) {
      requests++;
      await hold;
    }
    // Let the context fixture add the Preview protection header.
    await route.fallback();
  });
  try {
    await group.getByRole("radio", { checked: true }).focus();
    for (let step = 1; step <= 2; step++) {
      const labels = await radios.allTextContents();
      const selected = await group.getByRole("radio", { checked: true }).textContent();
      const target = radios.nth((labels.indexOf(selected!) + 1) % labels.length);
      hold = new Promise<void>((resolve) => { release = resolve; });
      await page.keyboard.press("ArrowRight");
      await expect(settings(page).locator(".settings-status")).toHaveText("Saving…");
      await expect(target).toBeFocused();
      await expect(target).toHaveAttribute("aria-disabled", "true");
      await expect.poll(() => requests).toBe(step);
      await page.keyboard.press("ArrowRight");
      await expect(target).toBeFocused();
      expect(requests).toBe(step);
      release!();
      hold = undefined;
      await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
      await expect(target).toBeFocused();
      await expect(target).toBeChecked();
      await expect(target).not.toHaveAttribute("aria-disabled", "true");
    }
    await page.keyboard.press("Tab");
    await expect(settings(page).getByRole("radiogroup", { name: "Response style" }).getByRole("radio", { checked: true })).toBeFocused();
  } finally {
    release?.();
    hold = undefined;
    await page.unroute("**/*");
    await expect(group.getByRole("radio", { name: original!, exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await group.getByRole("radio", { name: original!, exact: true }).click();
    await expect(group.getByRole("radio", { name: original!, exact: true })).toBeChecked();
    await expect(settings(page).locator(".settings-error")).toHaveCount(0);
  }
});

test("signed-in sections and expanded picker fit narrow layouts in both themes", async ({ qaPage: page }, info) => {
  test.setTimeout(90_000);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    for (const theme of ["Dark", "Light"]) {
      await select(page, "General");
      await settings(page).getByRole("button", { name: `${theme} theme` }).click();
      await settings(page).getByRole("button", { name: /^Settings section:/ }).click();
      const navigation = settings(page).getByRole("navigation", { name: "Section", exact: true });
      expect((await navigation.boundingBox())!.height).toBeLessThanOrEqual(200);
      await page.screenshot({ path: info.outputPath(`picker-${width}-${theme.toLowerCase()}.png`) });
      await page.keyboard.press("Escape");
      for (const section of sections) {
        await select(page, section);
        await expect(settings(page).getByRole("heading", { name: section, exact: true })).toBeVisible();
        expect(await settings(page).locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    await expect(settings(page)).toHaveCount(0);
  }
});
