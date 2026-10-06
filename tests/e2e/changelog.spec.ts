import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { getWhatsNewPreview, parseChangelog } from "../../lib/changelog";

test("public changelog retains semantic release hierarchy and existing metadata", async ({ page }) => {
  await page.goto("/changelog");

  await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
  await expect(page.getByText("Product updates", { exact: true })).toBeVisible();
  await expect(page.getByText("What's new in Nibie.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Unreleased" })).toBeVisible();
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();
  await expect(page.locator(".changelog-entry--unreleased .changelog-date")).toHaveCount(0);
  await expect(page.getByText("Development snapshot", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Current development" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Added" })).toBeVisible();
  const attachmentNote = page.locator(".changelog-entry--unreleased li").filter({ hasText: "Attach up to three text-based files" });
  await expect(attachmentNote).toContainText("conversation");
  await expect(attachmentNote).not.toContainText("migration");
  await expect(attachmentNote).not.toContainText("0009");
  await expect(attachmentNote).not.toContainText("**");
  await expect(attachmentNote).not.toContainText("](");
  await expect(page.locator(".changelog-column")).not.toContainText(/GET \/api\/health|Vercel|release:check|request id|integration test suite/i);
  await expect(page).toHaveTitle("Nibie Changelog");
  await expect(page.locator("meta[name='description']")).toHaveAttribute("content", "Product updates, improvements, and fixes for Nibie.");
  await expect(page.getByRole("link", { name: "Changelog", exact: true }).last()).toHaveAttribute("aria-current", "page");
});

test("changelog column widens on larger screens without horizontal scrolling", async ({ page }) => {
  await page.goto("/changelog");

  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      mainWidth: document.querySelector(".changelog-column")?.getBoundingClientRect().width ?? 0,
    }));
    expect(metrics.documentWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewportWidth);
    if (width === 390) expect(metrics.mainWidth).toBeGreaterThanOrEqual(388);
    else if (width === 768) expect(metrics.mainWidth).toBeGreaterThanOrEqual(700);
    else expect(metrics.mainWidth).toBeGreaterThanOrEqual(850);
  }
});

test("account Help shows the latest release, or Unreleased highlights until one ships", async ({ page }) => {
  const document = parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
  const release = getWhatsNewPreview(document);
  await page.addInitScript(() => localStorage.removeItem("nibie:last-seen-release"));
  await page.goto("/preview");

  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.locator(".account-profile").click();
  await sidebar.getByRole("menuitem", { name: "Help" }).click();

  const panel = sidebar.locator(".account-help-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("What’s new", { exact: true })).toBeVisible();
  await expect(panel.getByRole("menuitem", { name: "View full changelog" })).toHaveAttribute("href", "/changelog");
  if (!release) {
    await expect(panel.getByText("No updates yet.", { exact: true })).toBeVisible();
    return;
  }

  await expect(panel.getByText(release.kind === "release" ? `Nibie ${release.version}` : "Latest updates", { exact: true })).toBeVisible();
  await expect(panel.getByText(release.kind === "release" ? release.date : "In progress", { exact: true })).toBeVisible();
  await expect(panel.getByText("No shipped release yet.")).toHaveCount(0);
  for (const highlight of release.highlights) await expect(panel.getByText(highlight, { exact: true })).toBeVisible();
  await expect(panel.locator(".account-help-new")).toHaveText("New");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nibie:last-seen-release"))).toBe(release.seenKey);
  await sidebar.getByRole("menuitem", { name: "Help" }).press("Enter");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".account-help-new")).toHaveCount(0);
});

test("mobile Help preview stays inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  await page.getByRole("button", { name: "Open conversation menu" }).click();

  const sidebar = page.locator(".mobile-sidebar");
  await sidebar.locator(".account-profile").click();
  await sidebar.getByRole("menuitem", { name: "Help" }).click();
  const panel = sidebar.locator(".account-help-panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
});
