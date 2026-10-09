import { expect, test } from "@playwright/test";

test.describe("Workbench V2 panel", () => {
  test("keeps chat usable beside the editor on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/preview/workbench-v2");
    await expect(page.getByTestId("workbench-v2-preview")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit in Workbench" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Improve with AI" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Document", exact: true })).toHaveValue(/patient intake/);
    const chatBox = await page.locator(".chat-main").boundingBox();
    const panelBox = await page.locator(".workbench-panel").boundingBox();
    expect(chatBox && panelBox && chatBox.width > 360 && panelBox.width >= 440).toBeTruthy();
  });

  test("exposes Improve with AI prompt and review controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/preview/workbench-v2");
    await page.getByRole("button", { name: "Improve with AI" }).click();
    await expect(page.getByPlaceholder("How should Nibie improve this document?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate suggestion", exact: true })).toBeVisible();

    await page.goto("/preview/workbench-v2?state=review");
    await expect(page.getByRole("heading", { name: "Review suggestion" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply changes", exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".workbench-panel")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    await expect(page.getByRole("button", { name: "Apply changes" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 568 });
    const body = page.getByRole("textbox", { name: "Document", exact: true });
    await body.scrollIntoViewIfNeeded();
    await expect(body).toBeVisible();
  });
});
