import { expect, test, type Page } from "@playwright/test";

const picker = (page: Page) => page.getByRole("button", { name: /^Model:/ });
const newChat = (page: Page) => page.getByRole("button", { name: "New chat", exact: true }).filter({ visible: true }).first().click();
async function chooseModel(page: Page, model: "Fast" | "Balanced" | "High") {
  await picker(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${model}`) }).click();
}
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message Nibie" }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message-row.user")).toContainText(text);
}

// Uses the existing mock workspace: no provider calls or account data changes.
test("saved Fast default reaches new chats and Room threads while existing model and account default stay separate", async ({ page }) => {
  await page.goto("/preview");
  await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).first().click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Nibie", exact: true }).click();
  await settings.getByRole("radiogroup", { name: "Default model" }).getByRole("radio", { name: "Fast", exact: true }).click();
  await expect(settings.locator(".settings-status")).toHaveText("Saved");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await newChat(page);
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");

  await chooseModel(page, "High");
  await send(page, "Keep High on this thread");
  await newChat(page);
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");

  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.locator("[data-room-id]").getByRole("button", { name: "Nibie Development", exact: true }).click();
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");
  await send(page, "Room uses saved Fast");
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");

  await sidebar.locator("[data-conversation-id]").filter({ hasText: "Keep High on this thread" }).locator(".history-item").click();
  await expect(picker(page)).toHaveAccessibleName("Model: High");
  await chooseModel(page, "Balanced");
  await newChat(page);
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");
});
