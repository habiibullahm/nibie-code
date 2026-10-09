import { expect, test } from "@playwright/test";

test.describe("Workbench V2 panel", () => {
  test("keeps chat usable beside the editor on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/preview/workbench-v2");
    await expect(page.getByTestId("workbench-v2-preview")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit in Workbench" })).toBeVisible();
    await expect(page.getByRole("button", { name: "AI Assist" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Expand" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Document title" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Document", exact: true })).toHaveValue(/Intake checklist/);
    await expect(page.getByRole("group", { name: "Editor mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Write", exact: true })).toHaveAttribute("aria-pressed", "true");
    const chatBox = await page.locator(".chat-main").boundingBox();
    const panelBox = await page.locator(".workbench-panel").boundingBox();
    expect(chatBox && panelBox && chatBox.width > 360 && panelBox.width >= 440 && panelBox.width <= 560).toBeTruthy();
  });

  test("toggles Write to Preview and renders Markdown", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/preview/workbench-v2");
    await expect(page.getByRole("textbox", { name: "Document", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Document preview")).toBeVisible();
    await expect(page.locator(".workbench-preview .markdown h1")).toHaveText("Clinic onboarding");
    await expect(page.locator(".workbench-preview .markdown h2").first()).toHaveText("Intake checklist");
    await expect(page.locator(".workbench-preview .markdown ul li").first()).toHaveText("Confirm patient identity");
    await expect(page.getByRole("textbox", { name: "Document", exact: true })).toHaveCount(0);

    await page.goto("/preview/workbench-v2?state=preview");
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".workbench-preview .markdown h1")).toBeVisible();
  });

  test("exposes AI Assist prompt and Apply/Discard review", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/preview/workbench-v2");
    await page.getByRole("button", { name: "AI Assist" }).click();
    await expect(page.getByPlaceholder("Ask AI to edit…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeVisible();

    await page.goto("/preview/workbench-v2?state=review");
    await expect(page.getByRole("heading", { name: "Suggested revision" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Regenerate suggestion" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".workbench-panel")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 568 });
    const body = page.getByRole("textbox", { name: "Document", exact: true });
    await body.scrollIntoViewIfNeeded();
    await expect(body).toBeVisible();
  });

  test("uses overlay layout on tablet widths", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/preview/workbench-v2");
    await expect(page.locator(".workbench-panel-scrim")).toBeVisible();
    const panelBox = await page.locator(".workbench-panel").boundingBox();
    expect(panelBox && panelBox.width <= 560).toBeTruthy();
  });
});
