import { expect, test } from "@playwright/test";

test.describe("Workbench V2 panel", () => {
  test("keeps chat usable beside the editor on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/preview/workbench-v2");
    await expect(page.getByTestId("workbench-v2-preview")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit in Workbench" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Document actions" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Expand" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Document title" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Document", exact: true })).toHaveValue(/Patient intake/);
    const chatBox = await page.locator(".chat-main").boundingBox();
    const panelBox = await page.locator(".workbench-panel").boundingBox();
    expect(chatBox && panelBox && chatBox.width > 360 && panelBox.width >= 440 && panelBox.width <= 560).toBeTruthy();
  });

  test("opens AI Assist from the actions menu for inline edit", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/preview/workbench-v2");
    await page.getByRole("button", { name: "Document actions" }).click();
    await page.getByRole("menuitem", { name: "AI Assist" }).click();
    await expect(page.getByPlaceholder("Ask AI to edit…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Suggested revision" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
  });

  test("toggles Markdown Write and Preview", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/preview/workbench-v2");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("region", { name: "Document preview" }).or(page.getByLabel("Document preview"))).toBeVisible();
    await expect(page.locator(".workbench-preview .markdown h2")).toContainText("Patient intake");
    await expect(page.locator(".workbench-preview .markdown li")).toHaveCount(3);
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Document", exact: true })).toBeVisible();

    await page.goto("/preview/workbench-v2?state=preview");
    await expect(page.locator(".workbench-preview .markdown")).toBeVisible();
  });

  test("uses overlay layout on tablet widths", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/preview/workbench-v2");
    await expect(page.locator(".workbench-panel-scrim")).toBeVisible();
    const panelBox = await page.locator(".workbench-panel").boundingBox();
    expect(panelBox && panelBox.width <= 560).toBeTruthy();
  });
});
