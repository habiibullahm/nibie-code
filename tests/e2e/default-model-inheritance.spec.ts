import { expect, test, type Page } from "@playwright/test";

const picker = (page: Page) => page.getByRole("button", { name: /^Model:/ });
const newChat = (page: Page) => page.getByRole("button", { name: "New chat", exact: true }).filter({ visible: true }).first().click();

async function openModelSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).first().click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Nibie", exact: true }).click();
  const defaults = settings.getByRole("radiogroup", { name: "Default model" });
  await expect(defaults.getByRole("radio", { checked: true })).toBeEnabled();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  return { settings, defaults };
}

async function chooseModel(page: Page, model: "Fast" | "Balanced" | "High") {
  await picker(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${model}`) }).click();
}

async function sendPreview(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message Nibie" }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message-row.user")).toContainText(text);
}

// Reuses the preview inheritance scenario from PR #98; preview changes stay in this tab.
test("saved Fast default reaches new chats and Room threads while existing chats retain their model", async ({ page }) => {
  await page.goto("/preview");
  const { settings, defaults } = await openModelSettings(page);
  await defaults.getByRole("radio", { name: "Fast", exact: true }).click();
  await expect(settings.locator(".settings-status")).toHaveText("Saved");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await newChat(page);
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");

  await chooseModel(page, "High");
  await sendPreview(page, "Keep High on this thread");
  await newChat(page);
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");

  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.locator("[data-room-id]").getByRole("button", { name: "Nibie Development", exact: true }).click();
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");
  await sendPreview(page, "Room uses saved Fast");
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");

  await sidebar.locator("[data-conversation-id]").filter({ hasText: "Keep High on this thread" }).locator(".history-item").click();
  await expect(picker(page)).toHaveAccessibleName("Model: High");
  await chooseModel(page, "Balanced");
  await newChat(page);
  await expect(picker(page)).toHaveAccessibleName("Model: Fast");
  const reopened = await openModelSettings(page);
  await expect(reopened.defaults.getByRole("radio", { name: "Fast", exact: true })).toBeChecked();
});

test("persisted Fast default survives refresh and a fresh sign-in without provider calls", async ({ page, browser }) => {
  test.skip(!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD, "Requires a dedicated authenticated test account; no provider configuration is needed.");
  test.setTimeout(120_000);
  let originalDefault: string | undefined;
  let providerRequests = 0;
  const protectProvider = async (target: Page) => {
    await target.route("**/api/chat", async (route) => {
      providerRequests += 1;
      await route.abort();
    });
  };
  const login = async (target: Page) => {
    await target.goto("/login");
    await target.getByLabel("Email", { exact: true }).fill(process.env.E2E_USER_EMAIL!);
    await target.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(target).toHaveURL((url) => url.pathname === "/chat", { timeout: 20_000 });
    await newChat(target);
  };
  await protectProvider(page);
  try {
    await login(page);
    const { settings, defaults } = await openModelSettings(page);
    originalDefault = (await defaults.getByRole("radio", { checked: true }).innerText()).trim();
    if (originalDefault !== "Fast") {
      await defaults.getByRole("radio", { name: "Fast", exact: true }).click();
      await expect(settings.locator(".settings-status")).toHaveText("Saved");
    }
    await settings.getByRole("button", { name: "Close settings", exact: true }).click();
    await newChat(page);
    await expect(picker(page)).toHaveAccessibleName("Model: Fast");
    await page.reload();
    await expect(picker(page)).toHaveAccessibleName("Model: Fast");

    const freshSession = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const signedIn = await freshSession.newPage();
      await protectProvider(signedIn);
      await login(signedIn);
      await expect(picker(signedIn)).toHaveAccessibleName("Model: Fast");
    } finally {
      await freshSession.close();
    }
    expect(providerRequests).toBe(0);
  } finally {
    if (originalDefault && originalDefault !== "Fast") {
      await page.goto("/chat");
      const { settings, defaults } = await openModelSettings(page);
      await defaults.getByRole("radio", { name: originalDefault, exact: true }).click();
      await expect(settings.locator(".settings-status")).toHaveText("Saved");
    }
  }
});
