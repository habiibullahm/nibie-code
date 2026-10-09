import { expect, test } from "@playwright/test";

const title = "Debouncing a search box";

test("thread menu copies a plain transcript without Markdown markers", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/preview");

  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  const menu = page.getByRole("menu", { name: `Actions for ${title}` });
  await expect(menu.getByRole("menuitem", { name: "Copy transcript" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Download transcript (.md)" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Copy transcript" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Transcript copied." })).toBeVisible();
  const plain = await page.evaluate(() => navigator.clipboard.readText());
  expect(plain).toContain(title);
  expect(plain).toContain("User");
  expect(plain).toContain("Assistant");
  expect(plain).toContain("debounce");
  expect(plain).not.toContain("```");
  expect(plain).not.toContain("## Example");
  expect(plain).not.toContain("**");
});

test("transcript menu item stays keyboard-reachable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  await page.getByRole("button", { name: "Open conversation menu" }).click();
  const sidebar = page.locator(".mobile-sidebar");
  await sidebar.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  const menu = page.getByRole("menu", { name: `Actions for ${title}` });
  await expect(menu.getByRole("menuitem", { name: "Copy transcript" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: `Actions for ${title}`, exact: true })).toBeFocused();
});
