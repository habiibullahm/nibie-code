import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";

const DEFAULT_BASE_URL = "http://localhost:3100";

function e2eBaseUrl() {
  return process.env.E2E_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

async function installVercelPreviewAccess(context: BrowserContext) {
  const token = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!token) return;

  const targetOrigin = new URL(e2eBaseUrl()).origin;
  await context.route("**/*", async (route) => {
    let requestOrigin: string;
    try {
      requestOrigin = new URL(route.request().url()).origin;
    } catch {
      await route.continue();
      return;
    }

    if (requestOrigin !== targetOrigin) {
      await route.continue();
      return;
    }

    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-vercel-trusted-oidc-idp-token": token,
      },
    });
  });
}

async function signInQaUser(page: Page) {
  const email = process.env.E2E_USER_EMAIL?.trim();
  const password = process.env.E2E_USER_PASSWORD;

  // Default `npm run test:e2e` includes this fixture; skip when credentials are absent
  // (same policy as other credential e2e specs). Dedicated `npm run test:qa:smoke`
  // fails earlier via scripts/qa-smoke.mjs when credentials are missing.
  test.skip(!email || !password, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat", { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeVisible();
}

type QaFixtures = {
  qaPage: Page;
};

export const test = base.extend<QaFixtures>({
  qaPage: async ({ context, page }, useFixture) => {
    await installVercelPreviewAccess(context);
    await signInQaUser(page);
    await useFixture(page);
  },
});

export { expect };
