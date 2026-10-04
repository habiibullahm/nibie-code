import { expect, test } from "@playwright/test";

test("a fresh composer shows one mode picker defaulting to Balanced, and a new chat keeps that default", async ({ page }) => {
  await page.goto("/preview");
  await expect(page.getByRole("button", { name: "Model: Balanced", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Room: General", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
  await expect(page.getByRole("menuitemradio")).toHaveText([/^Fast/, /^Balanced/, /^High/]);
  await page.getByRole("menuitemradio", { name: /^High/ }).click();
  await expect(page.getByRole("button", { name: "Model: High", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Model: Balanced", exact: true })).toBeVisible();
});

test("Plus is a subtle accessible icon button connected to the existing safe attachment flow", async ({ page }) => {
  await page.goto("/preview");
  const attachment = page.getByRole("button", { name: "Attach file", exact: true });
  await expect(attachment).toHaveAttribute("title", "Attach file");
  await expect(attachment).toHaveAttribute("type", "button");
  await expect(attachment).toHaveText("");
  await expect(attachment.locator("svg.lucide-plus")).toHaveCount(1);
  await attachment.focus();
  await expect(attachment).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("This preview isn't connected.", { exact: true })).toBeVisible();
  await expect(page.locator(".message-row.user")).toHaveCount(0);
});
