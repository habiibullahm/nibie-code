import { expect, test } from "@playwright/test";
import { removeConversation } from "./remove-conversation";

// One capability picker (Fast / Balanced / High); provider names and reasoning vocabulary stay out of the composer and the request.
test("the mode picker sends only a mode and persists without exposing provider names", async ({ page }) => {
  test.skip(!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD, "Requires a dedicated authenticated test account and real provider configuration.");
  test.setTimeout(240_000);
  let conversationUrl: string | undefined;
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(process.env.E2E_USER_EMAIL!);
    await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/chat", { timeout: 20_000 });
    await page.getByRole("button", { name: "New chat", exact: true }).first().click();
    await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Model:/ }).click();
    await expect(page.getByRole("menu", { name: "Select model" })).not.toContainText(/GPT|DeepSeek|MiniMax|OpenAI/);
    await page.getByRole("menuitemradio", { name: /^Fast/ }).click();
    const sent = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/chat" && request.method() === "POST", { timeout: 60_000 });
    await page.getByRole("textbox", { name: "Message Nibie" }).fill("Reply with one short sentence about tides.");
    await page.getByRole("button", { name: "Send message" }).click();
    const request = (await sent).postDataJSON();
    expect(request.model).toBe("Fast");
    expect(request).not.toHaveProperty("provider");
    expect(request).not.toHaveProperty("reasoning");
    await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeVisible({ timeout: 120_000 });
    conversationUrl = page.url();
    await page.reload();
    await expect(page.getByRole("button", { name: "Model: Fast", exact: true })).toBeVisible();
  } finally {
    await removeConversation(page, conversationUrl);
  }
});
