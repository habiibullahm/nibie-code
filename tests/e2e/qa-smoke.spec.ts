import type { Page } from "@playwright/test";
import { test, expect } from "./qa-fixture";
import { conversationIdFromUrl } from "./remove-conversation";

async function archiveConversation(page: Page, url: string | undefined) {
  const id = conversationIdFromUrl(url);
  if (!id) return;

  await page.goto(`/chat?conversation=${encodeURIComponent(id)}`);
  await expect(page).toHaveURL((current) => current.pathname === "/chat" && current.searchParams.get("conversation") === id);

  const row = page.locator(".desktop-sidebar").locator(`[data-conversation-id="${id}"]`);
  const archive = row.getByRole("button", { name: /^Archive / });
  if (await archive.count() === 1) {
    await archive.click();
    await expect(row).toHaveCount(0);
  }
}

test("signed-in QA preview can generate and persist one real reply", async ({ qaPage: page }) => {
  test.setTimeout(180_000);

  let conversationUrl: string | undefined;
  try {
    await expect(page).toHaveURL((url) => url.pathname === "/chat");
    await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeVisible();

    const modelButton = page.getByRole("button", { name: /^Model:/ });
    await modelButton.click();
    const fast = page.getByRole("menuitemradio", { name: /^Fast/ });
    if (await fast.count() === 1) await fast.click();
    else await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "New chat", exact: true }).first().click();
    await expect(page.getByTestId("welcome-greeting")).toBeVisible();

    const responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/chat" && response.request().method() === "POST",
      { timeout: 130_000 },
    );

    await page.getByRole("textbox", { name: "Message Nibie" }).fill("QA smoke: reply with a short confirmation that the preview is working.");
    await page.getByRole("button", { name: "Send message" }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/event-stream");

    await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0, { timeout: 130_000 });
    const answer = page.locator(".message-row.assistant .markdown").last();
    await expect(answer).not.toHaveText("…");
    const text = (await answer.textContent())?.trim();
    expect(text).toBeTruthy();

    await expect(page).toHaveURL((url) => url.pathname === "/chat" && Boolean(url.searchParams.get("conversation")));
    conversationUrl = page.url();

    await page.reload();
    await expect(page.locator(".message-row.assistant .markdown").last()).toHaveText(text!);
  } finally {
    await archiveConversation(page, conversationUrl);
  }
});
