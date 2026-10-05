import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;

test.skip(!email || !password, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat", { timeout: 20_000 });
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

test("preferred language persists across a refresh", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const language = dialog(page).getByRole("radiogroup", { name: "Preferred language" });
  const english = language.getByRole("radio", { name: "English" });
  const auto = language.getByRole("radio", { name: "Auto" });
  await expect(english).toBeEnabled();
  const startedOnEnglish = (await english.getAttribute("aria-checked")) === "true";
  await (startedOnEnglish ? auto : english).click();
  await expect(dialog(page).locator(".settings-status")).toHaveText("Saved");
  await page.keyboard.press("Escape");

  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(english).toBeEnabled();
  await expect(language.getByRole("radio", { name: startedOnEnglish ? "Auto" : "English" })).toHaveAttribute("aria-checked", "true");

  await (startedOnEnglish ? english : auto).click();
  await expect(dialog(page).locator(".settings-status")).toHaveText("Saved");
});
