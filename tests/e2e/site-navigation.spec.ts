import { expect, test } from "@playwright/test";

for (const width of [320, 390]) {
  for (const route of ["/", "/docs", "/privacy"]) {
    test(`mobile navigation on ${route} at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(route);
      const primary = page.getByRole("navigation", { name: "Primary", exact: true });
      const toggle = primary.getByRole("button", { name: /navigation menu/ });
      await expect(primary.getByRole("link", { name: "Workbench", exact: true })).toHaveCount(0);
      await expect(primary.getByRole("link", { name: "Docs", exact: true })).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath("mobile-header.png"), animations: "disabled" });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(primary.getByRole("link", { name: "Open Nibie", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("mobile-menu.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(primary.getByRole("link", { name: "Open Nibie", exact: true })).toBeHidden();
      await expect(toggle).toBeFocused();
      await toggle.press("Enter");
      await page.keyboard.press("Tab");
      await expect(primary.getByRole("link", { name: "Product", exact: true })).toBeFocused();
      await primary.getByRole("link", { name: "Docs", exact: true }).click();
      await expect(page).toHaveURL(/\/docs$/);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await page.getByText("Your first conversation", { exact: true }).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await page.setViewportSize({ width: 1024, height: 900 });
      await expect(toggle).toBeHidden();
      await expect(primary.getByRole("link", { name: "Docs", exact: true })).toBeVisible();
      await expect(primary.getByRole("link", { name: "Workbench", exact: true })).toHaveCount(0);
    });
  }
}
