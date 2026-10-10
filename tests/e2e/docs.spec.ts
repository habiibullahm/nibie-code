import { expect, test } from "@playwright/test";

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`public docs navigation and topics at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Docs", exact: true }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(page).toHaveTitle("Docs · Nibie");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make yourself at home.");

    await page.screenshot({ path: testInfo.outputPath("docs-dark.png"), animations: "disabled" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.screenshot({ path: testInfo.outputPath("docs-light.png"), animations: "disabled" });

    if (width <= 760) await page.getByText("On this page", { exact: true }).click();
    const topics = page.getByRole("navigation", { name: "Documentation topics" }).getByRole("link");
    await expect(topics).toHaveCount(9);
    for (const topic of await topics.all()) {
      const label = await topic.innerText();
      await topic.click();
      const heading = page.getByRole("heading", { level: 2, name: label, exact: true });
      await expect(heading).toBeInViewport();
      expect(await heading.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(80);
    }
    await page.getByText("Can I attach files?", { exact: true }).click();
    const attachmentsHelp = page.locator("details").filter({ has: page.getByText("Can I attach files?", { exact: true }) });
    await expect(attachmentsHelp).toContainText("up to three");
    await expect(attachmentsHelp).toContainText("10 MB per file and 20 MB total");
    await expect(attachmentsHelp).toContainText("PDF");
    await expect(attachmentsHelp).toContainText("Images and scanned PDFs are not supported");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Docs", exact: true }).click();
    await expect(page).toHaveURL(/\/docs$/);
    expect(errors).toEqual([]);
  });
}
