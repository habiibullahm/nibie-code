import { expect, test } from "@playwright/test";
import { conversationIdFromUrl, removeConversation } from "./remove-conversation";

test("authenticated provider response survives refresh, reopen, and sign-in again", async ({ page }) => {
  test.skip(!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD, "Requires a dedicated authenticated test account and real provider configuration.");
  test.setTimeout(180_000);
  const email = process.env.E2E_USER_EMAIL!;
  const password = process.env.E2E_USER_PASSWORD!;
  const prompt = "Write two short paragraphs explaining why conversations should survive page refreshes.";
  let conversationUrl: string | undefined;
  let title: string | undefined;

  async function login() {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/chat", { timeout: 20_000 });
  }

  try {
    await login();
    await page.getByRole("button", { name: "New chat", exact: true }).first().click();
    await expect(page).toHaveURL((url) => url.pathname === "/chat" && !url.searchParams.has("conversation"));
    await expect(page.getByTestId("welcome-greeting")).toBeVisible();
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/chat" && response.request().method() === "POST", { timeout: 130_000 });
    await page.getByRole("textbox", { name: "Message Nibie" }).fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({ timeout: 60_000 });
    const streamingLayout = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>(".conversation-scroll.has-messages")!;
      const dock = document.querySelector<HTMLElement>(".chat-main > .composer-dock")!;
      return { viewportBottom: viewport.getBoundingClientRect().bottom, composerTop: dock.getBoundingClientRect().top };
    });
    expect(streamingLayout.viewportBottom).toBeLessThanOrEqual(streamingLayout.composerTop + 1);
    // New chat is lazy: the conversation (and its URL) is created together with the first message.
    await expect(page).toHaveURL((url) => url.pathname === "/chat" && Boolean(url.searchParams.get("conversation")));
    conversationUrl = page.url();
    expect(response.headers()["content-type"]).toContain("text/event-stream");
    const stream = await response.text();
    expect(stream).toContain("event: start");
    expect(stream).toContain("event: delta");
    expect(stream).toContain('event: status\ndata: {"status":"complete"}');
    expect(stream).not.toContain("event: error");
    await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
    const answer = await page.locator(".message-row.assistant .markdown").last().textContent();
    expect(answer?.trim()).toBeTruthy();
    expect(answer).not.toBe("…");

    await page.reload();
    await expect(page.locator(".message-row.assistant .markdown").last()).toHaveText(answer!);
    expect(await page.locator(".message-row.assistant .markdown").last().textContent()).toBe(answer);
    title = (await page.locator(".desktop-sidebar .history-item.is-active").textContent())?.trim();
    expect(title).toBeTruthy();
    const conversationId = conversationIdFromUrl(conversationUrl);
    expect(conversationId).toBeTruthy();
    await page.goto("/chat");
    await page.locator(".desktop-sidebar").locator(`[data-conversation-id="${conversationId}"]`).locator(".history-item").click();
    await expect(page).toHaveURL((url) => url.pathname === "/chat" && url.searchParams.get("conversation") === conversationId);
    await expect(page.locator(".message-row.assistant .markdown").last()).toHaveText(answer!);
    await page.locator(".desktop-sidebar .account-profile").hover();
    await page.locator(".desktop-sidebar").getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    await login();
    await page.goto(conversationUrl);
    await expect(page.locator(".message-row.assistant .markdown").last()).toHaveText(answer!);
    expect(await page.locator(".message-row.assistant .markdown").last().textContent()).toBe(answer);
  } finally {
    await removeConversation(page, conversationUrl);
  }
});
