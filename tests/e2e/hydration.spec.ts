import { expect, test } from "@playwright/test";

// The real signed-in workspace shape (rooms, threads in rooms and General, an active room thread, messages) must hydrate cleanly for
// viewers whose locale and time zone differ from the server's. A Swedish viewer used to hydrate a different room order than the one
// the server rendered, because rooms were sorted with the runtime's default locale.
const hydration = /hydrat|did not match|server rendered|didn't match|Minified React error #(418|419|421|422|423|425)/i;
const environments = [
  { name: "sv-SE (Å Ä Ö after Z)", locale: "sv-SE", timezoneId: "UTC" },
  { name: "tr-TR", locale: "tr-TR", timezoneId: "Asia/Jakarta" },
  { name: "ja-JP", locale: "ja-JP", timezoneId: "America/Los_Angeles" },
];

for (const environment of environments) {
  for (const width of [1440, 390]) {
    test(`sidebar hydrates cleanly for ${environment.name} at ${width}px, with timestamps on`, async ({ browser }) => {
      const context = await browser.newContext({ locale: environment.locale, timezoneId: environment.timezoneId, viewport: { width, height: 900 } });
      await context.addInitScript(() => localStorage.setItem("nibie-show-timestamps", "true"));
      const page = await context.newPage();
      const problems: string[] = [];
      page.on("console", (message) => { if (hydration.test(message.text())) problems.push(message.text().slice(0, 300)); });
      page.on("pageerror", (error) => { if (hydration.test(error.message)) problems.push(error.message.slice(0, 300)); });
      await page.goto("/preview/sidebar-hydration");
      await page.waitForLoadState("networkidle");
      if (width <= 760) await page.getByRole("button", { name: "Open conversation menu" }).click();
      await expect(page.locator("[data-conversation-id]").first()).toBeVisible();
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
