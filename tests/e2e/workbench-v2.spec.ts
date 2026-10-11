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

  test("exposes version history and export actions from the document menu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/preview/workbench-v2");
    await page.getByRole("button", { name: "Document actions" }).click();
    const menu = page.getByRole("menu", { name: "Document actions" });
    await expect(menu.getByRole("menuitem", { name: "Save version" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Version history" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Download Markdown" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Download plain text" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copy formatted for Word/Docs" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Version history" }).click();
    await expect(page.getByRole("dialog", { name: "Version history" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  });

  test("shows Ask Nibie on selected text for inline edit", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/preview/workbench-v2");
    const body = page.getByRole("textbox", { name: "Document", exact: true });
    await body.click();
    await body.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      const start = textarea.value.indexOf("Confirm insurance");
      const end = start + "Confirm insurance".length;
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
    // Triple-click fallback: ensure a non-empty span reaches React state in headless.
    await expect.poll(async () => body.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      return textarea.selectionEnd > textarea.selectionStart ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) : "";
    })).not.toBe("");
    await expect(page.getByRole("button", { name: "Ask Nibie" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Ask Nibie" }).click();
    await expect(page.getByPlaceholder("Ask Nibie to change this…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeVisible();
    await expect(page.getByText(/Selection · /)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Suggested revision" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "AI Assist" })).toHaveCount(0);
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
