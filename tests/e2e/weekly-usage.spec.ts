import { expect, test, type Page } from "@playwright/test";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

test("keeps weekly usage quiet in General settings and the picker shows safe mode weights", async ({ page }) => {
  await page.goto("/preview");
  await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
  const picker = page.getByRole("menu", { name: "Select model", exact: true });
  await expect(picker.getByRole("menuitemradio", { name: /Fast.*1 credit/ })).toBeVisible();
  await expect(picker.getByRole("menuitemradio", { name: /Balanced.*3 credits/ })).toBeVisible();
  await expect(picker.getByRole("menuitemradio", { name: /High.*6 credits/ })).toBeVisible();
  await expect(picker).not.toContainText(/OpenAI|DeepSeek|GPT|API key|provider/i);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = dialog(page);
  await expect(settings.getByRole("heading", { name: "Weekly AI usage" })).toBeVisible();
  await expect(settings.getByText("Free usage resets weekly. There’s no paid plan or billing yet.")).toBeVisible();
  await expect(settings.getByText("Weekly usage is available in your signed-in account.")).toBeVisible();
  await expect(settings.getByText(/Upgrade|Buy credits|Subscribe/i)).toHaveCount(0);
});

test("weekly usage settings fit a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  await page.getByRole("button", { name: "Open conversation menu" }).click();
  await page.locator(".mobile-sidebar").getByRole("button", { name: "Settings", exact: true }).click();
  const settings = dialog(page);
  await expect(settings.getByRole("heading", { name: "Weekly AI usage" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("weekly quota rejection removes the optimistic reply and shows the reset notice", async ({ page }) => {
  await page.route("**/preview/chat-core**", async (route) => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    const args = JSON.parse(route.request().postData() ?? "[]") as unknown[];
    if (args.length !== 4) return route.abort();
    const result = { data: { id: args[2], position: 5 } };
    await route.fulfill({ contentType: "text/x-component", body: `0:{"a":"$@1","f":[],"b":"development"}\n1:${JSON.stringify(result)}\n` });
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return originalFetch(input, options);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return new Response(JSON.stringify({
        code: "WEEKLY_USAGE_LIMIT",
        error: "You've reached your weekly Nibie usage limit.",
        creditsRemaining: 0,
        resetAt: "2026-10-05T00:00:00.000Z",
      }), { status: 429, headers: { "content-type": "application/json" } });
    };
  });
  await page.goto("/preview/chat-core?workspace=1&mode=Balanced&conversation=5e9bdcca-9205-4fea-a773-13952bb78c44");
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Check weekly quota");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toHaveCount(1);
  await expect(page.locator(".local-notice")).toContainText("weekly Nibie usage limit");
  await expect(page.getByText("Check weekly quota", { exact: true })).toBeVisible();
  await expect(page.locator(".message-row.assistant")).toHaveCount(0);
});
