import { expect, test, type Page } from "@playwright/test";

// Theme, brand, model/reasoning pickers and layout checks. These run against the local mock workspace (/preview) and the sign-in
// page, so they need neither an account nor a provider.
const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);


async function openThemeSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

test.describe("theme", () => {
  test("is dark by default, including on a device that prefers light", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/login");
    expect(await theme(page)).toBe("dark");
    expect(await background(page)).toBe("rgb(21, 20, 18)");
    await context.close();
  });

  test("applies the stored choice before the page paints, without a flash", async ({ browser }) => {
    const context = await browser.newContext();
    // The attribute is read at the first possible moment: when the document starts rendering, before any paint.
    await context.addInitScript(() => {
      localStorage.setItem("nibie-theme", "light");
      // Observing the document (not <html>, which does not exist yet) records every data-theme change from the first parsed byte.
      new MutationObserver(() => {
        const value = document.documentElement.getAttribute("data-theme");
        (window as unknown as { __themes: string[] }).__themes = [...((window as unknown as { __themes?: string[] }).__themes ?? []), String(value)];
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
    });
    const page = await context.newPage();
    await page.goto("/login");
    expect(await theme(page)).toBe("light");
    expect(await background(page)).toBe("rgb(252, 251, 249)");
    // The server rendered "dark"; the inline script changed it once, to light, and nothing switched back afterwards.
    const changes = await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes);
    expect(changes.at(-1)).toBe("light");
    expect(changes).not.toContain("dark");
    await context.close();
  });

  test("can be switched in the workspace and is remembered after a reload", async ({ page }) => {
    await page.goto("/preview");
    expect(await theme(page)).toBe("dark");
    await openThemeSettings(page);
    const dark = page.getByRole("button", { name: "Dark theme" }).first();
    const light = page.getByRole("button", { name: "Light theme" }).first();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await light.click();
    expect(await theme(page)).toBe("light");
    await expect(light).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    expect(await theme(page)).toBe("light");
    await openThemeSettings(page);
    await expect(page.getByRole("button", { name: "Light theme" }).first()).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Dark theme" }).first().click();
    await page.reload();
    expect(await theme(page)).toBe("dark");
  });

  test("System follows the device setting", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/preview");
    await openThemeSettings(page);
    await page.getByRole("button", { name: "System theme" }).first().click();
    expect(await theme(page)).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => theme(page)).toBe("dark");
    await context.close();
  });

  test("keeps text readable in both themes", async ({ page }) => {
    await page.goto("/preview");
    await page.getByRole("button", { name: "Debouncing a search box", exact: true }).click();
    const contrast = () => page.evaluate(() => {
      const channels = (value: string) => (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const luminance = ([r, g, b]: number[]) => { const [x, y, z] = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
      const ratio = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
      const bg = channels(getComputedStyle(document.querySelector(".chat-workspace")!).backgroundColor);
      return [".message-content.user p", ".markdown p", ".message-author", ".history-item.is-active"].map((selector) => ratio(channels(getComputedStyle(document.querySelector(selector)!).color), bg));
    });
    for (const ratio of await contrast()) expect(ratio).toBeGreaterThan(4.5);
    await openThemeSettings(page);
    await page.getByRole("button", { name: "Light theme" }).first().click();
    for (const ratio of await contrast()) expect(ratio).toBeGreaterThan(4.5);
  });
});

test.describe("brand", () => {
  test("shows the lowercase wordmark with the logo mark and keeps a clean, consistent name", async ({ page }) => {
    await page.goto("/login");
    const brand = page.getByRole("link", { name: "Nibie", exact: true });
    await expect(brand).toContainText("Nibie");
    await expect(brand.locator(".brand-mark svg")).toBeVisible();
    await expect(page).toHaveTitle("Nibie");
    await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute("href", /icon/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "Nibie");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#151412");
  });
});

test.describe("mode picker (mock workspace)", () => {
  test("offers only Fast, Balanced and High, defaults to Balanced, and is keyboard operable", async ({ page }) => {
    await page.goto("/preview");
    const picker = page.getByRole("button", { name: "Model: Balanced", exact: true });
    await expect(picker).toHaveText("Balanced");
    await expect(picker).toHaveAttribute("aria-haspopup", "menu");
    await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);
    await picker.click();
    const menu = page.getByRole("menu", { name: "Model" });
    await expect(menu.getByRole("menuitemradio")).toHaveText([/^Fast\s*Quick answers/, /^Balanced\s*Best for everyday work/, /^High\s*Deeper reasoning/]);
    await expect(menu.getByRole("menuitemradio", { name: /^Balanced/ })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitemradio", { name: /^Fast/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Model: Fast", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Model: Fast", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Model: Fast", exact: true })).toBeFocused();
    // Provider names and reasoning vocabulary never appear in the composer.
    await expect(page.locator(".composer")).not.toContainText(/Reasoning|Low|Medium|Auto|GPT|DeepSeek|MiniMax|OpenAI|preview-/);
  });

  test("shows the chosen mode", async ({ page }) => {
    await page.goto("/preview");
    await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^High/ }).click();
    await expect(page.getByRole("button", { name: "Model: High", exact: true })).toHaveText("High");
  });
});

test.describe("layout has no horizontal overflow", () => {
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    for (const scheme of ["dark", "light"] as const) {
      test(`${width}px, ${scheme} theme, with menus open`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width, height } });
        await context.addInitScript((value) => localStorage.setItem("nibie-theme", value), scheme);
        const page = await context.newPage();
        await page.goto("/preview");
        if (width <= 760) await page.getByRole("button", { name: "Open conversation menu" }).click();
        await page.getByRole("button", { name: "Debouncing a search box", exact: true }).first().click();
        await expect(page.locator(".code-block")).toBeVisible();
        await page.getByRole("button", { name: /^Model:/ }).click();
        const menu = await page.locator(".composer-menu-list").boundingBox();
        expect(menu!.x).toBeGreaterThanOrEqual(0);
        expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        // Wide code blocks scroll inside their own box instead of widening the page.
        const code = page.locator(".code-block pre");
        expect(await code.evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true);
        await context.close();
      });
    }
  }
});

test.describe("conversation scrolling", () => {
  const atBottom = (page: Page) => page.evaluate(() => { const box = document.querySelector(".conversation-scroll")!; return box.scrollHeight - box.scrollTop - box.clientHeight; });

  test("opens at the latest message, and a sent message is brought into view even when the reader had scrolled up", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 520 });
    await page.goto("/preview");
    await page.getByRole("button", { name: "Open conversation menu" }).click();
    await page.getByRole("button", { name: "Debouncing a search box", exact: true }).first().click();
    await expect(page.locator(".code-block")).toBeVisible();
    // The conversation is taller than the screen, and it opens at its end rather than at the first message.
    expect(await page.evaluate(() => { const box = document.querySelector(".conversation-scroll")!; return box.scrollHeight > box.clientHeight; })).toBe(true);
    expect(await atBottom(page)).toBeLessThanOrEqual(2);

    await page.evaluate(() => { document.querySelector(".conversation-scroll")!.scrollTop = 0; });
    await expect.poll(() => atBottom(page)).toBeGreaterThan(100);
    await page.getByRole("textbox", { name: "Message Nibie" }).fill("A message sent from the top of a long chat");
    await page.getByRole("button", { name: "Send message" }).click();
    const sent = page.locator(".message-row.user").filter({ hasText: "A message sent from the top of a long chat" });
    await expect(sent).toBeInViewport();
    expect(await atBottom(page)).toBeLessThanOrEqual(2);
  });

  test("does not pull the reader back down while they are reading earlier text", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 520 });
    await page.goto("/preview");
    await page.getByRole("button", { name: "Open conversation menu" }).click();
    await page.getByRole("button", { name: "Debouncing a search box", exact: true }).first().click();
    await expect(page.locator(".code-block")).toBeVisible();
    await page.evaluate(() => { document.querySelector(".conversation-scroll")!.scrollTop = 0; });
    // Unrelated updates (opening a menu, changing the mode) must not move the reader.
    await page.getByRole("button", { name: /^Model:/ }).click();
    await page.getByRole("menuitemradio", { name: /^Fast/ }).click();
    expect(await page.evaluate(() => document.querySelector(".conversation-scroll")!.scrollTop)).toBe(0);
  });
});

test.describe("hydration", () => {
  // Smoke check: the pages must hydrate without console errors for viewers far from the server's time zone. The history headings
  // (Today / Yesterday / Older) depend on the viewer's clock and zone, so server and browser must agree while hydrating, otherwise React
  // discards the server HTML and re-renders everything on the client. The zone boundaries themselves are covered in tests/unit/chat-groups.test.ts.
  for (const timezoneId of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Jakarta"]) {
    test(`the workspace and sign-in pages hydrate without errors in ${timezoneId}`, async ({ browser }) => {
      const context = await browser.newContext({ timezoneId });
      const page = await context.newPage();
      const problems: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") problems.push(message.text().split("\n")[0]); });
      page.on("pageerror", (error) => problems.push(error.message.split("\n")[0]));
      for (const path of ["/login", "/signup", "/preview"]) {
        await page.goto(path);
        await page.waitForSelector("main");
        await page.waitForTimeout(500);
      }
      expect(problems).toEqual([]);
      await context.close();
    });
  }
});
