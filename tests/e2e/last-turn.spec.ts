import { expect, test, type Page } from "@playwright/test";
import { removeConversation } from "./remove-conversation";

// Authenticated, real-provider checks for the M5 last-turn controls. Skipped without the dedicated E2E account;
// a skip never counts as acceptance. Each test removes only the conversation it created.
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

function chatResponse(page: Page) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === "/api/chat" && response.request().method() === "POST", { timeout: 130_000 });
}

async function completedStream(page: Page, trigger: () => Promise<void>) {
  const pending = chatResponse(page);
  await trigger();
  const response = await pending;
  expect(response.status()).toBe(200);
  const stream = await response.text();
  expect(stream).toContain('event: status\ndata: {"status":"complete"}');
  expect(stream).not.toContain("event: error");
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
  return response;
}

async function openNewChat(page: Page) {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await expect(page.getByTestId("welcome-greeting")).toBeVisible();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message Nibie" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

const assistant = (page: Page) => page.locator(".message-row.assistant .markdown");
const userBubble = (page: Page) => page.locator(".message-row.user .message-content.user p");

test("regenerate replaces the last reply, edit resends the last message, and both survive a reload", async ({ page, context }) => {
  test.setTimeout(360_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let url: string | undefined;
  try {
    await login(page);
    await openNewChat(page);
    await completedStream(page, () => send(page, "Reply with exactly one short sentence about rivers."));
    await expect(page).toHaveURL(/conversation=/);
    url = page.url();
    await expect(assistant(page)).toHaveCount(1);
    expect((await assistant(page).textContent())?.trim()).toBeTruthy();

    // Regenerate: same user message, exactly one reply afterwards, no ghost row.
    const regenerated = await completedStream(page, () => page.getByRole("button", { name: "Regenerate", exact: true }).click());
    expect(regenerated.request().postDataJSON()).toMatchObject({ regenerate: true });
    await expect(assistant(page)).toHaveCount(1);
    await expect(userBubble(page)).toHaveCount(1);
    const afterRegenerate = (await assistant(page).textContent())!.trim();
    expect(afterRegenerate).toBeTruthy();
    await page.reload();
    await expect(assistant(page)).toHaveCount(1);
    expect((await assistant(page).textContent())!.trim()).toBe(afterRegenerate);

    // Copy: the reply copies to the clipboard and confirms.
    await page.getByRole("button", { name: "Copy response", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy response", exact: true })).toContainText("Copied");
    expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBeTruthy();

    // Edit and resend: the last user message changes in place and its reply is regenerated for the new text.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit message" });
    await expect(page.getByRole("button", { name: "Save & resend" })).toBeDisabled();
    await editor.fill("Reply with exactly one short sentence about mountains.");
    const edited = await completedStream(page, () => page.getByRole("button", { name: "Save & resend" }).click());
    expect(edited.request().postDataJSON()).not.toHaveProperty("regenerate");
    await expect(userBubble(page)).toHaveCount(1);
    await expect(userBubble(page)).toHaveText("Reply with exactly one short sentence about mountains.");
    await expect(assistant(page)).toHaveCount(1);
    const afterEdit = (await assistant(page).textContent())!.trim();
    expect(afterEdit).toBeTruthy();

    await page.reload();
    await expect(userBubble(page)).toHaveCount(1);
    await expect(userBubble(page)).toHaveText("Reply with exactly one short sentence about mountains.");
    await expect(assistant(page)).toHaveCount(1);
    expect((await assistant(page).textContent())!.trim()).toBe(afterEdit);
  } finally {
    await removeConversation(page, url ?? (page.url().includes("conversation=") ? page.url() : undefined));
  }
});

test("a stopped response persists as interrupted and Retry completes it", async ({ page }) => {
  test.setTimeout(360_000);
  let url: string | undefined;
  try {
    await login(page);
    await openNewChat(page);
    const pending = chatResponse(page);
    await send(page, "Write a detailed 500 word story about a lighthouse keeper.");
    await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/conversation=/);
    url = page.url();
    await expect(assistant(page).first()).not.toHaveText("", { timeout: 60_000 });
    await page.getByRole("button", { name: "Stop response" }).click();
    await pending;
    await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
    await expect(page.locator(".message-author").last()).toContainText("Stopped");
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator(".message-author").last()).toContainText("Stopped");
    await expect(assistant(page)).toHaveCount(1);

    const retried = await completedStream(page, () => page.getByRole("button", { name: "Retry", exact: true }).click());
    expect(retried.request().postDataJSON()).toMatchObject({ regenerate: true });
    await expect(assistant(page)).toHaveCount(1);
    await expect(page.locator(".message-row.assistant").last().locator(".message-status", { hasText: "Stopped" })).toHaveCount(0);
    await page.reload();
    await expect(assistant(page)).toHaveCount(1);
    await expect(page.locator(".message-row.assistant").last().locator(".message-status", { hasText: "Stopped" })).toHaveCount(0);
  } finally {
    await removeConversation(page, url ?? (page.url().includes("conversation=") ? page.url() : undefined));
  }
});
