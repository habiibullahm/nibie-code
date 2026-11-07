import { expect, test } from "@playwright/test";

test("landing Try Nibie opens the public demo and shows an AI reply without login", async ({ page }) => {
  const forbidden: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/chat") || url.includes("/rest/v1/") || url.includes("/auth/v1/")) forbidden.push(url);
  });

  await page.goto("/");
  await page.locator(".landing-hero").getByRole("link", { name: "Try Nibie" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/demo");
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId("demo-banner")).toContainText("Demo mode");
  await expect(page.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", "https://github.com/habiibullahm/nibie-code");
  await expect(page.getByText("Lead with the decision, then the reason.")).toBeVisible();
  await page.getByRole("button", { name: "Room file size and App Router", exact: true }).click();
  await expect(page.getByText("From saved Memory: Room files stay at 5 MB per file.")).toBeVisible();
  await expect(page.getByText("Used Web Search")).toBeVisible();
  await expect(page.getByLabel("Sources, 1")).toBeVisible();
  await page.getByRole("link", { name: "Source 1" }).click();
  await expect(page.getByRole("link", { name: "Getting Started: App Router" })).toHaveAttribute("href", "https://nextjs.org/docs/app/getting-started");
  expect(forbidden).toEqual([]);
});
