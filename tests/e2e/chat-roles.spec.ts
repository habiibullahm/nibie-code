import { expect, test, type Page } from "@playwright/test";

async function openRoleMenu(page: Page) {
  const button = page.getByRole("button", { name: /^Role:/ });
  await expect(button).toBeVisible();
  await button.click();
  return page.getByRole("menu", { name: /select role/i });
}

test("chat role menu is keyboard reachable and Custom opens instructions", async ({ page }) => {
  await page.goto("/preview");
  await page.setViewportSize({ width: 390, height: 844 });

  const roleButton = page.getByRole("button", { name: /^Role:/ });
  await expect(roleButton).toHaveAttribute("aria-label", "Role: General");
  await roleButton.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: /select role/i });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /Developer/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await openRoleMenu(page);
  await page.getByRole("menuitemradio", { name: /Custom/i }).click();
  await expect(page.getByRole("button", { name: /^Role:/ })).toHaveAttribute("aria-label", "Role: Custom");

  await page.getByRole("button", { name: /chat instructions/i }).click();
  const dialog = page.getByRole("dialog", { name: "Chat instructions" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/do not override safety rules/i)).toBeVisible();
  await dialog.getByLabel(/Custom instructions/i).fill("Prefer short bullet answers.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Edit chat instructions/i })).toBeVisible();
});

test("chat roles stay isolated between conversations in preview", async ({ page }) => {
  await page.goto("/preview");
  await page.setViewportSize({ width: 1280, height: 800 });

  await openRoleMenu(page);
  await page.getByRole("menuitemradio", { name: /Writer/i }).click();
  await expect(page.getByRole("button", { name: /^Role:/ })).toHaveAttribute("aria-label", "Role: Writer");

  await page.getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Role:/ })).toHaveAttribute("aria-label", "Role: General");

  await openRoleMenu(page);
  await page.getByRole("menuitemradio", { name: /Researcher/i }).click();
  await expect(page.getByRole("button", { name: /^Role:/ })).toHaveAttribute("aria-label", "Role: Researcher");

  await page.getByRole("button", { name: "Debouncing a search box", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Role:/ })).toHaveAttribute("aria-label", "Role: General");
});
