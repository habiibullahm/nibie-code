import { expect, test, type Page } from "@playwright/test";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("settings shell", () => {
  test("opens from the account area, moves between sections, and closes", async ({ page }) => {
    await page.goto("/preview");
    await openSettings(page);
    await expect(dialog(page).getByRole("heading", { name: "General" })).toBeVisible();
    for (const name of ["AI & Models", "Chat", "Personalization", "Memory & Context", "Usage & Plan", "Data & Privacy"]) {
      await dialog(page).getByRole("tab", { name, exact: true }).click();
      await expect(dialog(page).getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    await openSettings(page);
    await dialog(page).getByRole("button", { name: "Close settings" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("saves a new-chat default without changing the open conversation", async ({ page }) => {
    await page.goto("/preview");
    await page.getByRole("button", { name: "Debouncing a search box", exact: true }).click();
    await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^High/ }).click();
    await expect(page.getByRole("button", { name: "Model: High", exact: true })).toBeEnabled();

    await openSettings(page);
    await dialog(page).getByRole("tab", { name: "AI & Models", exact: true }).click();
    await dialog(page).getByRole("radio", { name: "Fast", exact: true }).click();
    await expect(dialog(page).getByRole("status")).toHaveText("Saved");
    await page.keyboard.press("Escape");

    // The open conversation keeps its own mode; a new chat follows the saved default (Fast).
    await expect(page.getByRole("button", { name: "Model: High", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New chat", exact: true }).first().click();
    await expect(page.getByTestId("welcome-greeting")).toBeVisible();
    await expect(page.getByRole("button", { name: "Model: Fast", exact: true })).toBeVisible();
    await page.locator(".desktop-sidebar").getByRole("button", { name: "Nibie Development", exact: true }).click();
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await expect(page.getByRole("button", { name: "Model: Fast", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Model: Fast", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^High/ }).click();
    await openSettings(page);
    await dialog(page).getByRole("tab", { name: "AI & Models", exact: true }).click();
    await expect(dialog(page).getByRole("radiogroup", { name: "Default model" }).getByRole("radio", { name: "Fast", exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "New chat", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Model: Fast", exact: true })).toBeVisible();
  });

  test("offers Concise, Default, and Detailed response depth, with Default selected", async ({ page }) => {
    await page.goto("/preview");
    await openSettings(page);
    await dialog(page).getByRole("tab", { name: "AI & Models", exact: true }).click();
    const depth = dialog(page).getByRole("radiogroup", { name: "Response depth" });
    await expect(depth.getByRole("radio")).toHaveText(["Concise", "Default", "Detailed"]);
    await expect(depth.getByRole("radio", { name: "Default", exact: true })).toBeChecked();
    // Balanced stays the model capability name only.
    await expect(dialog(page).getByRole("radiogroup", { name: "Default model" }).getByRole("radio", { name: "Balanced", exact: true })).toBeVisible();
    await expect(dialog(page).getByRole("radio", { name: "Balanced", exact: true })).toHaveCount(1);
  });
});
