import { expect, test, type Page } from "@playwright/test";

async function openChatInstructions(page: Page, title: string) {
  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole("menu", { name: `Actions for ${title}` }).getByRole("menuitem", { name: "Chat instructions" }).click();
  const dialog = page.getByRole("dialog", { name: "Chat instructions" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function threadButton(page: Page, title: string) {
  return page.locator(".desktop-sidebar").getByRole("button", { name: title, exact: true });
}

test("conversation menu opens Chat instructions and supports save and clear", async ({ page }) => {
  await page.goto("/preview");
  await page.setViewportSize({ width: 1280, height: 800 });

  const title = "A thoughtful note to the team";
  const dialog = await openChatInstructions(page, title);
  await expect(dialog.getByText(/How should Nibie respond/i)).toBeVisible();
  await expect(dialog.getByText(/do not override safety rules/i)).toBeVisible();
  await dialog.getByLabel(/Custom instructions/i).fill("Prefer short bullet answers.");
  await dialog.getByRole("button", { name: "Save instructions" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(threadButton(page, title)).toHaveAttribute("aria-description", "Custom instructions active");
  await expect(threadButton(page, title).locator(".history-instructions-badge")).toBeVisible();

  const again = await openChatInstructions(page, title);
  await expect(again.getByLabel(/Custom instructions/i)).toHaveValue("Prefer short bullet answers.");
  await again.getByRole("button", { name: "Clear" }).click();
  await expect(again).toHaveCount(0);
  await expect(threadButton(page, title)).not.toHaveAttribute("aria-description", "Custom instructions active");
  await expect(threadButton(page, title).locator(".history-instructions-badge")).toHaveCount(0);
});

test("chat instructions stay isolated between conversations in preview", async ({ page }) => {
  await page.goto("/preview");
  await page.setViewportSize({ width: 1280, height: 800 });

  const writing = "A thoughtful note to the team";
  const coding = "Debouncing a search box";

  const writingDialog = await openChatInstructions(page, writing);
  await writingDialog.getByLabel(/Custom instructions/i).fill("Write warmly.");
  await writingDialog.getByRole("button", { name: "Save instructions" }).click();
  await expect(writingDialog).toHaveCount(0);
  await expect(threadButton(page, writing)).toHaveAttribute("aria-description", "Custom instructions active");

  await threadButton(page, coding).click();
  await expect(threadButton(page, coding).locator(".history-instructions-badge")).toHaveCount(0);

  const codingDialog = await openChatInstructions(page, coding);
  await expect(codingDialog.getByLabel(/Custom instructions/i)).toHaveValue("");
  await codingDialog.getByLabel(/Custom instructions/i).fill("Prefer TypeScript examples.");
  await codingDialog.getByRole("button", { name: "Save instructions" }).click();
  await expect(codingDialog).toHaveCount(0);

  await threadButton(page, writing).click();
  const writingAgain = await openChatInstructions(page, writing);
  await expect(writingAgain.getByLabel(/Custom instructions/i)).toHaveValue("Write warmly.");
  await writingAgain.getByRole("button", { name: "Cancel" }).click();

  await threadButton(page, coding).click();
  const codingAgain = await openChatInstructions(page, coding);
  await expect(codingAgain.getByLabel(/Custom instructions/i)).toHaveValue("Prefer TypeScript examples.");
});
