import { expect, test, type Page } from "@playwright/test";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Nibie" });
const transcript = (page: Page, text: string) => page.locator(".message-list").getByText(text, { exact: true });

async function openChatSettings(page: Page, opener = page.getByRole("button", { name: "Settings" })) {
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  if (await dialog.getByRole("button", { name: /^Settings section:/ }).isVisible()) {
    await dialog.getByRole("button", { name: /^Settings section:/ }).click();
    await dialog.getByRole("navigation", { name: "Section", exact: true }).getByRole("button", { name: "Chat", exact: true }).click();
  }
  else await dialog.getByRole("tab", { name: "Chat" }).click();
  return dialog;
}

test("Enter sends by default, and Shift+Enter stays a newline", async ({ page }) => {
  await page.goto("/preview");
  const box = composer(page);
  await box.fill("First line");
  await box.press("Shift+Enter");
  await box.type("second");
  await box.press("Enter");
  await expect(transcript(page, "First line\nsecond")).toBeVisible();
  await expect(box).toHaveValue("");
});

test("Enter inserts a newline and Ctrl+Enter sends when Enter to send is off", async ({ page }) => {
  await page.goto("/preview");
  const dialog = await openChatSettings(page);
  await dialog.getByRole("switch", { name: "Enter to send" }).click();
  await expect(dialog.getByRole("switch", { name: "Enter to send" })).toHaveAttribute("aria-checked", "false");
  await dialog.getByRole("button", { name: "Close settings" }).click();

  const box = composer(page);
  await box.fill("Held");
  await box.press("Enter");
  await expect(box).toHaveValue("Held\n");
  await expect(transcript(page, "Held")).toHaveCount(0);
  await box.press("Control+Enter");
  await expect(transcript(page, "Held")).toBeVisible();
});

test("auto-follow stays with a sent message only while it is on", async ({ page }) => {
  await page.goto("/preview");
  const scroller = page.locator(".conversation-scroll");
  const box = composer(page);
  const long = `${"A line of preview text.\n".repeat(30)}End of the note.`;

  await box.fill(long);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(96);

  await scroller.evaluate((el) => { el.scrollTop = 0; });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await box.fill("Caught up");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(transcript(page, "Caught up")).toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(96);

  const dialog = await openChatSettings(page);
  await dialog.getByRole("switch", { name: "Auto-follow streaming" }).click();
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await scroller.evaluate((el) => { el.scrollTop = 0; });
  await box.fill("Stay put");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(transcript(page, "Stay put")).toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
});

test("timestamps stay hidden until enabled, and the choice survives reload", async ({ page }) => {
  await page.goto("/preview");
  await page.getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await expect(page.locator(".message-time")).toHaveCount(0);

  const dialog = await openChatSettings(page);
  await dialog.getByRole("switch", { name: "Show timestamps" }).click();
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator(".message-time")).toHaveCount(2);
  await expect(page.locator(".message-time").first()).toHaveAttribute("dateTime", "2026-10-01T08:30:00.000Z");

  await page.reload();
  await page.getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await expect(page.locator(".message-time")).toHaveCount(2);
  const reopened = await openChatSettings(page);
  await expect(reopened.getByRole("switch", { name: "Show timestamps" })).toHaveAttribute("aria-checked", "true");
});

test("invalid stored preferences keep the defaults", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nibie-enter-to-send", "sometimes");
    localStorage.setItem("nibie-auto-follow", "nope");
    localStorage.setItem("nibie-show-timestamps", "yes");
    localStorage.setItem("nibie-restore-last-chat", "enabled");
    localStorage.setItem("nibie-last-conversation", "<script>");
  });
  await page.goto("/preview");
  await page.getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await expect(page.getByTestId("welcome-greeting")).toHaveCount(0);
  await expect(page.locator(".message-time")).toHaveCount(0);
  const box = composer(page);
  await box.fill("Defaults hold");
  await box.press("Enter");
  await expect(transcript(page, "Defaults hold")).toBeVisible();

  const dialog = await openChatSettings(page);
  await expect(dialog.getByRole("switch", { name: "Enter to send" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("switch", { name: "Auto-follow streaming" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("switch", { name: "Show timestamps" })).toHaveAttribute("aria-checked", "false");
  await expect(dialog.getByRole("switch", { name: "Restore last conversation" })).toHaveAttribute("aria-checked", "false");
});

test("mobile composer sends with the button when Enter is a newline", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(await overflow()).toBe(false);

  const box = composer(page);
  await box.fill("From the phone");
  await box.press("Enter");
  await expect(transcript(page, "From the phone")).toBeVisible();

  await page.getByRole("button", { name: "Open conversation menu" }).click();
  const dialog = await openChatSettings(page, page.getByRole("dialog", { name: "Conversation menu" }).getByRole("button", { name: "Settings" }));
  await expect(dialog.getByRole("heading", { name: "Chat" })).toBeVisible();
  expect(await overflow()).toBe(false);
  await dialog.getByRole("switch", { name: "Enter to send" }).click();
  await dialog.getByRole("button", { name: "Close settings" }).click();

  await box.fill("New line");
  await box.press("Enter");
  await expect(box).toHaveValue("New line\n");
  await expect(transcript(page, "New line")).toHaveCount(0);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(transcript(page, "New line")).toBeVisible();
  expect(await overflow()).toBe(false);
});
