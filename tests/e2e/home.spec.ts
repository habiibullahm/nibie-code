import { expect, test } from "@playwright/test";

test("the public landing page does not require authentication", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page).toHaveTitle("Nibie — A quieter place to think with AI");
  await expect(page.getByRole("heading", { level: 1, name: "A quieter place to think with AI." })).toBeVisible();
  const opens = page.getByRole("link", { name: "Open Nibie" });
  await expect(opens).toHaveCount(2);
  for (const link of await opens.all()) await expect(link).toHaveAttribute("href", "/chat");
  const tries = page.getByRole("link", { name: "Try Nibie" });
  await expect(tries).toHaveCount(2);
  for (const link of await tries.all()) await expect(link).toHaveAttribute("href", "/chat");
  await expect(page.locator(".landing-hero").getByRole("link", { name: "Try Nibie" })).toHaveAttribute("href", "/chat");
  await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#product");
});

test("landing page has no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const frame = await page.locator(".landing-frame").boundingBox();
  expect(frame?.width).toBeGreaterThan(300);
  expect(frame?.height).toBeGreaterThan(400);
  const message = page.locator(".landing-frame .message-content").first();
  const messageBox = await message.boundingBox();
  expect(messageBox?.height).toBeGreaterThan(20);
});

test("unauthenticated visitors to the workspace are sent to sign in", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  await expect(page).toHaveTitle("Nibie");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nibie" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("an authenticated session can still open the landing page", async ({ page }) => {
  test.skip(!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD, "Requires a dedicated authenticated test account.");
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(process.env.E2E_USER_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat", { timeout: 20_000 });
  await page.goto("/");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1, name: "A quieter place to think with AI." })).toBeVisible();
});


test("a saved root conversation link enters the workspace route", async ({ request }) => {
  const id = "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60";
  const response = await request.get(`/?conversation=${id}`, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe(`/chat?conversation=${id}`);
});

test("the marketing page stays put without a conversation id", async ({ request }) => {
  const response = await request.get("/?conversation=not-a-conversation", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
});

test("landing controls are reachable from the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Tab");
  const brand = page.getByRole("link", { name: "Nibie", exact: true });
  await expect(brand).toBeFocused();
  const outline = await brand.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});

test("sign-in has no horizontal overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("sign-up page provides an account creation form", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

test("desktop chat workspace opens history and submits local messages", async ({ page }) => {
  await page.goto("/preview");
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByTestId("welcome-greeting")).toBeVisible();
  await expect(page.getByRole("button", { name: "A thoughtful note to the team", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await expect(page.getByText("A good note can recognize the effort")).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Message Nibie" });
  await composer.fill("A local preview message");
  const oneLineHeight = await composer.evaluate((element) => element.getBoundingClientRect().height);
  await composer.press("Shift+Enter");
  await composer.type("second line");
  await expect.poll(() => composer.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(oneLineHeight);
  await composer.press("Enter");
  await expect(page.getByText("A local preview message\nsecond line")).toBeVisible();
  await expect(page.getByText("Your message is shown in this local preview.")).toContainText("Replies are not connected yet");
  await expect(page.getByRole("button", { name: "Model: Balanced", exact: true })).toBeVisible();
});

test("mobile chat workspace uses a keyboard-accessible conversation drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByRole("button", { name: "Open conversation menu" }).click();
  const menu = page.getByRole("dialog", { name: "Conversation menu" });
  await expect(menu.getByRole("button", { name: "Close menu" })).toBeFocused();
  await menu.getByRole("button", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("link", { name: "Nibie home" })).toBeFocused();
  await menu.getByRole("button", { name: "Expand Nibie Development", exact: true }).click();
  await menu.getByRole("button", { name: "Learning the basics of astronomy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open conversation menu" })).toBeFocused();
  await expect(page.getByText("Start by looking up.")).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeVisible();
});

test("assistant replies render safe Markdown with working copy controls", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/preview");
  await page.getByRole("button", { name: "Debouncing a search box", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Example" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Use wait to tune responsiveness." })).toBeVisible();
  const link = page.getByRole("link", { name: "MDN guide" });
  await expect(link).toHaveAttribute("href", "https://developer.mozilla.org/docs/Glossary/Debounce");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("target", "_blank");
  const block = page.locator(".code-block");
  await expect(block).toContainText("export function debounce");
  await expect(block.locator(".code-block-header")).toContainText("ts");

  const copyCode = block.getByRole("button", { name: "Copy ts code block" });
  await copyCode.click();
  await expect(copyCode).toContainText("Copied");
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code.startsWith("export function debounce")).toBe(true);
  expect(code).toContain("timer = setTimeout(");
  expect(code.endsWith("}")).toBe(true);
  expect(code).not.toContain("```");

  await page.getByRole("button", { name: "Copy response" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("## Example");

  // The mock workspace has no server, so last-turn mutation controls stay hidden here.
  await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
});
