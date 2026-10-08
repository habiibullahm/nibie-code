import { expect, test, type Page } from "@playwright/test";
import { removeConversation } from "./remove-conversation";

// Authenticated, real-provider regression checks for the Retry / terminal-event lifecycle.
// Reported symptom: after Retry the UI showed "Nibie couldn't complete that response", yet a reload showed the full,
// correctly persisted reply. The client treated any lost or unexpected stream outcome as a failure and never asked the
// server again. Skipped without the dedicated E2E account; a skip never counts as acceptance.
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;

test.describe.configure({ mode: "serial" });
test.skip(!email || !password, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat", { timeout: 20_000 });
}

const isChatPost = (response: { url(): string; request(): { method(): string } }) => new URL(response.url()).pathname === "/api/chat" && response.request().method() === "POST";
const assistant = (page: Page) => page.locator(".message-row.assistant .markdown");
const notices = (page: Page) => page.locator(".local-notice");
const regenerate = (page: Page) => page.getByRole("button", { name: "Regenerate", exact: true });

async function startChat(page: Page, prompt: string) {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await expect(page.getByTestId("welcome-greeting")).toBeVisible();
  await page.getByRole("textbox", { name: "Message Nibie" }).fill(prompt);
}

test("a stream that drops before its terminal event reconciles to the saved reply", async ({ page }) => {
  test.setTimeout(240_000);
  let url: string | undefined;
  try {
    await login(page);
    await startChat(page, "Reply with exactly one short sentence about harbours.");
    // The server finishes and saves the reply; the browser only receives the stream up to (not including) the terminal events.
    await page.route("**/api/chat", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const cut = body.indexOf("event: status");
      expect(cut).toBeGreaterThan(0);
      await route.fulfill({ response, body: body.slice(0, cut) });
    }, { times: 1 });
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/conversation=/);
    url = page.url();

    // Without a reload: the UI must settle on the saved, complete reply and offer Regenerate (not Retry), with no error notice.
    await expect(regenerate(page)).toBeVisible({ timeout: 90_000 });
    await expect(notices(page)).toHaveCount(0);
    await expect(page.locator(".message-row.assistant").last().locator(".message-status")).toHaveCount(0);
    const shown = (await assistant(page).textContent())!.trim();
    expect(shown).toBeTruthy();

    await page.reload();
    await expect(assistant(page)).toHaveCount(1);
    expect((await assistant(page).textContent())!.trim()).toBe(shown);
  } finally {
    await removeConversation(page, url);
  }
});

test("a regenerate that collides with a running generation settles on the saved reply", async ({ page }) => {
  test.setTimeout(240_000);
  let url: string | undefined;
  try {
    await login(page);
    await startChat(page, "Reply with exactly one short sentence about lanterns.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(regenerate(page)).toBeVisible({ timeout: 90_000 });
    url = page.url();
    const before = (await assistant(page).textContent())!.trim();

    // The server answers "another response is running" (the earlier generation had not finished saving yet).
    await page.route("**/api/chat", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Another response is running or a newer message was saved. Refresh and try again." }) }), { times: 1 });
    await regenerate(page).click();

    // It must not leave a stale failure behind: the saved reply is shown again and the controls work.
    await expect(notices(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(regenerate(page)).toBeEnabled({ timeout: 30_000 });
    await expect(assistant(page)).toHaveCount(1);
    expect((await assistant(page).textContent())!.trim()).toBe(before);
  } finally {
    await removeConversation(page, url);
  }
});

test("Retry right after Stop completes without a failure notice", async ({ page }) => {
  test.setTimeout(240_000);
  let url: string | undefined;
  try {
    await login(page);
    await startChat(page, "Write a detailed 500 word story about a lighthouse keeper.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/conversation=/);
    url = page.url();
    await expect(assistant(page).first()).not.toHaveText("", { timeout: 60_000 });
    await page.getByRole("button", { name: "Stop response" }).click();

    // Click Retry as soon as it can be used, then require a clean completion.
    const retried = page.waitForResponse(isChatPost, { timeout: 130_000 });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    const response = await retried;
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('event: status\ndata: {"status":"complete"}');
    await expect(regenerate(page)).toBeVisible({ timeout: 30_000 });
    await expect(notices(page)).toHaveCount(0);
    await expect(page.locator(".message-row.assistant").last().locator(".message-status")).toHaveCount(0);
    await page.reload();
    await expect(assistant(page)).toHaveCount(1);
    await expect(page.locator(".message-row.assistant").last().locator(".message-status")).toHaveCount(0);
  } finally {
    await removeConversation(page, url);
  }
});
