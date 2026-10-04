import { expect, test } from "@playwright/test";

test("desktop sidebar collapses to an accessible primary navigation rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/preview");

  const sidebar = page.locator(".desktop-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "264px");
  // Workbench is hidden from primary navigation for V1; its route and data are untouched.
  await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "64px");
  await expect(sidebar.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Rooms" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "General" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(sidebar.locator(".account-profile")).toHaveAccessibleName("Account");
  await expect(sidebar.getByText("Today", { exact: true })).toHaveCount(0);
  await expect(sidebar.locator("[data-conversation-id]")).toHaveCount(0);

  await sidebar.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("heading", { name: "What’s on your mind?" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeFocused();
  await expect(sidebar).toHaveCSS("width", "64px");

  await sidebar.getByRole("button", { name: "Rooms" }).click();
  await expect(sidebar).toHaveCSS("width", "264px");
  await expect(sidebar.locator("section[aria-label='Rooms']")).toBeFocused();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await sidebar.getByRole("button", { name: "General" }).click();
  await expect(sidebar).toHaveCSS("width", "264px");
  await expect(sidebar.locator("section[aria-label='Today']")).toBeFocused();
  await sidebar.locator("[data-conversation-id='preview-writing'] .history-item").click();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "General" })).toHaveClass(/is-active/);
  await sidebar.getByRole("button", { name: "Rooms" }).click();
  await sidebar.locator("section[aria-label='Rooms'] .history-item").filter({ hasText: "Nibie Development" }).click();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "Rooms" })).toHaveClass(/is-active/);
  await sidebar.getByRole("button", { name: "Expand sidebar" }).click();

  await sidebar.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Settings" })).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Close settings" }).click();

  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await sidebar.locator(".account-profile").click();
  await expect(sidebar.locator(".account-profile")).toHaveAttribute("aria-expanded", "true");
  await sidebar.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "264px");
  await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "New chat" })).toBeVisible();
});

test("sidebar keeps the desktop rail at wide breakpoints and uses the drawer on mobile", async ({ page }) => {
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/preview");
    const sidebar = page.locator(".desktop-sidebar");
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(sidebar).toHaveCSS("width", "64px");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  await expect(page.locator(".desktop-sidebar")).toBeHidden();
  await expect(page.getByRole("button", { name: "Open conversation menu" })).toBeVisible();
  await page.getByRole("button", { name: "Open conversation menu" }).click();
  const drawer = page.locator(".mobile-sidebar");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Close menu" })).toBeVisible();
  await drawer.getByRole("button", { name: "Close menu" }).click();
  await expect(drawer).toHaveCount(0);
});
