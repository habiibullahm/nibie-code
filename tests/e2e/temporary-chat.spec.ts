import { expect, test, type Page } from "@playwright/test";

const temporaryToggle = (page: Page) => page.getByRole("button", { name: "Temporary chat", exact: true }).first();
const newChat = (page: Page) => page.getByRole("button", { name: "New chat", exact: true }).filter({ visible: true }).first().click();
const sidebarEntry = (page: Page, text: string) => page.locator(".desktop-sidebar [data-conversation-id]").filter({ hasText: text });
async function send(page: Page, content: string) {
  await page.getByRole("textbox", { name: "Message Nibie" }).fill(content);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.beforeEach(async ({ page }) => { await page.goto("/preview"); });

test("a temporary chat stays out of history and is gone once you leave it", async ({ page }) => {
  await expect(temporaryToggle(page)).toHaveAttribute("aria-pressed", "false");
  await temporaryToggle(page).click();
  await expect(temporaryToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Temporary chat" })).toBeVisible();
  await expect(page.getByTestId("temporary-chat-intro")).toContainText("won't appear in your history");
  // A temporary chat is General only.
  await expect(page.getByRole("button", { name: /^Room:/ })).toHaveCount(0);

  await send(page, "Temporary hello");
  await expect(page.locator(".message-list")).toContainText("Temporary hello");
  await expect(page.locator(".chat-header")).toContainText("Temporary chat");
  await expect(temporaryToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(sidebarEntry(page, "Temporary hello")).toHaveCount(0);

  await newChat(page);
  await expect(temporaryToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("welcome-greeting")).toBeVisible();
  await expect(page.locator(".message-list")).toHaveCount(0);
  await expect(sidebarEntry(page, "Temporary hello")).toHaveCount(0);
});

test("an ordinary chat still lands in history, and the toggle starts a fresh temporary chat from it", async ({ page }) => {
  await send(page, "Ordinary hello");
  await expect(sidebarEntry(page, "Ordinary hello")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Room:/ })).toBeVisible();
  await temporaryToggle(page).click();
  await expect(page.getByRole("heading", { name: "Temporary chat" })).toBeVisible();
  await expect(page.locator(".message-list")).toHaveCount(0);
  // Turning it off again returns to an ordinary new chat.
  await temporaryToggle(page).click();
  await expect(page.getByTestId("welcome-greeting")).toBeVisible();
  await expect(sidebarEntry(page, "Ordinary hello")).toHaveCount(1);
});
