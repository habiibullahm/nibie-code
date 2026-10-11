import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
test.skip(!email || !password, "Requires a dedicated authenticated test account.");
const settings = (page: Page) => page.getByRole("dialog", { name: "Settings", exact: true });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat", { timeout: 20_000 });
}
async function open(page: Page, section: string) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await settings(page).getByRole("tab", { name: section, exact: true }).click();
}

// A dedicated account is required; restore saved text even when an assertion fails.
test("text survives a rejected save, retry, reload and fresh sign-in", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page);
  await open(page, "Personalization");
  const name = settings(page).getByLabel("Preferred name", { exact: true });
  await expect(name).toBeEnabled();
  const original = await name.inputValue();
  const newName = original === "Settings QA" ? "Settings retry QA" : "Settings QA";
  let rejected = false;
  await page.route("**/chat**", async (route) => {
    if (!rejected && route.request().headers()["next-action"] && route.request().postData()?.includes('"preferredName"')) {
      rejected = true;
      await route.abort("failed");
    } else await route.continue();
  });
  try {
    await name.fill(newName);
    await settings(page).getByRole("button", { name: "Save Preferred name" }).click();
    await expect(settings(page).getByRole("alert")).toContainText("couldn't be saved");
    await expect(name).toHaveValue(newName);
    await expect(settings(page).getByRole("button", { name: "Save Preferred name" })).toBeEnabled();
    await settings(page).getByRole("button", { name: "Save Preferred name" }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
    await page.reload();
    await open(page, "Personalization");
    await expect(name).toHaveValue(newName);
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const fresh = await context.newPage();
      await login(fresh);
      await open(fresh, "Personalization");
      await expect(settings(fresh).getByLabel("Preferred name", { exact: true })).toHaveValue(newName);
    } finally { await context.close(); }
    expect(rejected).toBe(true);
  } finally {
    await name.fill(original);
    await settings(page).getByRole("button", { name: "Save Preferred name" }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
  }
});

test("usage failure retries into the actual balance and reset, including zero allowance", async ({ page }) => {
  await login(page);
  let calls = 0;
  let mode: "unavailable" | "invalid" | "zero" = "unavailable";
  await page.route("**/api/usage", async (route) => {
    calls += 1;
    await route.fulfill(mode === "unavailable" ? { status: 503, json: { error: "Unavailable" } }
      : mode === "invalid" ? { json: { creditsUsed: 1, creditsRemaining: 500, resetAt: "2026-10-12T00:00:00.000Z" } }
      : { json: { creditsUsed: 500, creditsRemaining: 0, resetAt: "2026-10-12T00:00:00.000Z" } });
  });
  await open(page, "Usage & Plan");
  await expect(settings(page).getByRole("status").filter({ hasText: "couldn’t be loaded" })).toBeVisible();
  mode = "invalid";
  await settings(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(settings(page).getByRole("status").filter({ hasText: "couldn’t be loaded" })).toBeVisible();
  await expect(settings(page).getByText(/credits left this week/)).toHaveCount(0);
  mode = "zero";
  await settings(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(settings(page).getByText("0 credits left this week.")).toBeVisible();
  await expect(settings(page).getByText("500 of 500 credits used.")).toBeVisible();
  await expect(settings(page).getByText(/Your allowance resets/)).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(3);
  await expect(settings(page).getByRole("button", { name: /Upgrade|Subscribe|Buy/ })).toHaveCount(0);
});

test("privacy requires exact confirmation and export stays owner scoped", async ({ page }) => {
  await login(page);
  await open(page, "Data & Privacy");
  const remove = settings(page).getByRole("button", { name: "Delete all conversations", exact: true });
  await expect(remove).toBeDisabled();
  await settings(page).getByLabel("Type DELETE to confirm").fill("delete");
  await expect(remove).toBeDisabled();
  await settings(page).getByLabel("Type DELETE to confirm").fill("DELETE");
  await expect(remove).toBeEnabled();
  await expect(settings(page).getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    settings(page).getByRole("button", { name: "Export JSON" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("nibie-export-v2.json");
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream!) text += chunk.toString();
  const data = JSON.parse(text);
  expect(data.exportVersion).toBe(2);
  if (process.env.E2E_SETTINGS_MEMORY_FIXTURE) expect(text).toContain("Settings own export fixture");
  expect(text).not.toContain("Settings foreign account sentinel");
});

test("memory edits, forgetting, deletion and toggle persist without cross-account entries", async ({ page }) => {
  test.skip(!process.env.E2E_SETTINGS_MEMORY_FIXTURE, "Requires disposable local memory fixtures.");
  await login(page);
  await open(page, "Memory & Context");
  await expect(settings(page).getByRole("textbox", { name: "Memory (fact)" })).toHaveValue("Settings own memory fixture");
  expect(await settings(page).getByRole("textbox").evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).not.toContain("Settings foreign account sentinel");
  const row = settings(page).locator(".memory-row").filter({ has: page.getByRole("textbox", { name: "Memory (fact)" }) });
  await row.getByRole("textbox").fill("Settings edited memory fixture");
  await row.getByRole("button", { name: "Save memory" }).click();
  await expect(row.getByRole("button", { name: "Save memory" })).toBeDisabled();
  await page.reload();
  await open(page, "Memory & Context");
  await expect(row.getByRole("textbox")).toHaveValue("Settings edited memory fixture");
  const toggle = settings(page).getByRole("switch", { name: "Use saved memories" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await open(page, "Memory & Context");
  await expect(toggle).not.toBeChecked();
  await expect(row.getByRole("textbox")).toHaveValue("Settings edited memory fixture");
  await toggle.click();
  await expect(toggle).toBeChecked();
  await row.getByRole("button", { name: "Forget", exact: true }).click();
  await expect(row.getByText("Forgotten", { exact: true })).toBeVisible();
  await expect(row.getByRole("textbox")).toBeDisabled();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("About you, depth and style persist across reload and fresh sign-in", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await login(page);
  await open(page, "Personalization");
  const about = settings(page).getByLabel("About you", { exact: true });
  await expect(about).toBeEnabled();
  const originalAbout = await about.inputValue();
  const nextAbout = originalAbout === "Accessible Settings QA" ? "Settings QA context" : "Accessible Settings QA";
  await settings(page).getByRole("tab", { name: "AI & Models", exact: true }).click();
  const depth = settings(page).getByRole("radiogroup", { name: "Response depth" });
  const style = settings(page).getByRole("radiogroup", { name: "Response style" });
  const originalDepth = await depth.getByRole("radio", { checked: true }).innerText();
  const originalStyle = await style.getByRole("radio", { checked: true }).innerText();
  const nextDepth = originalDepth === "Detailed" ? "Concise" : "Detailed";
  const nextStyle = originalStyle === "Professional" ? "Direct" : "Professional";
  try {
    await depth.getByRole("radio", { name: nextDepth, exact: true }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
    await style.getByRole("radio", { name: nextStyle, exact: true }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
    await settings(page).getByRole("tab", { name: "Personalization", exact: true }).click();
    await about.fill(nextAbout);
    await settings(page).getByRole("button", { name: "Save About you" }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
    await page.reload();
    await open(page, "Personalization");
    await expect(about).toHaveValue(nextAbout);
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const fresh = await context.newPage();
      await login(fresh);
      await open(fresh, "Personalization");
      await expect(settings(fresh).getByLabel("About you", { exact: true })).toHaveValue(nextAbout);
      await settings(fresh).getByRole("tab", { name: "AI & Models", exact: true }).click();
      await expect(settings(fresh).getByRole("radiogroup", { name: "Response depth" }).getByRole("radio", { name: nextDepth, exact: true })).toBeChecked();
      await expect(settings(fresh).getByRole("radiogroup", { name: "Response style" }).getByRole("radio", { name: nextStyle, exact: true })).toBeChecked();
    } finally { await context.close(); }
  } finally {
    await about.fill(originalAbout);
    await settings(page).getByRole("button", { name: "Save About you" }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
    await settings(page).getByRole("tab", { name: "AI & Models", exact: true }).click();
    await depth.getByRole("radio", { name: originalDepth, exact: true }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
    await style.getByRole("radio", { name: originalStyle, exact: true }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
  }
});

test("failed account loading prevents edits and offers a working retry", async ({ page }) => {
  await login(page);
  let blocked = true;
  await page.route("**/chat**", async (route) => {
    if (blocked && route.request().headers()["next-action"] && route.request().postData() === "[]") await route.abort("failed");
    else await route.continue();
  });
  await open(page, "General");
  await expect(settings(page).getByRole("alert")).toContainText("couldn't be loaded");
  await expect(settings(page).getByRole("radio", { name: "English", exact: true })).toBeDisabled();
  await expect(settings(page).getByRole("button", { name: "Light theme" })).toBeEnabled();
  blocked = false;
  await settings(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(settings(page).getByRole("radio", { name: "English", exact: true })).toBeEnabled();
  await expect(settings(page).getByRole("alert")).toHaveCount(0);
});

test("live owner usage agrees with the endpoint balance and reset", async ({ page }) => {
  test.skip(!process.env.E2E_SETTINGS_MEMORY_FIXTURE, "Requires a disposable local usage account.");
  await login(page);
  const response = await page.request.get("/api/usage");
  expect(response.ok()).toBe(true);
  const usage = await response.json();
  expect(usage.creditsUsed + usage.creditsRemaining).toBe(500);
  expect(Number.isFinite(Date.parse(usage.resetAt))).toBe(true);
  await open(page, "Usage & Plan");
  await expect(settings(page).getByText(`${usage.creditsRemaining} credits left this week.`)).toBeVisible();
  await expect(settings(page).getByRole("progressbar", { name: "Weekly credits used" })).toHaveAttribute("value", String(usage.creditsUsed));
});

test("pending saves show Saving immediately and prevent overlapping edits", async ({ page }) => {
  await login(page);
  await open(page, "Personalization");
  const name = settings(page).getByLabel("Preferred name", { exact: true });
  await expect(name).toBeEnabled();
  const original = await name.inputValue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  await page.route("**/chat**", async (route) => {
    if (!held && route.request().headers()["next-action"] && route.request().postData()?.includes('"preferredName"')) {
      held = true;
      await gate;
    }
    await route.continue();
  });
  try {
    await name.fill(original === "Pending QA" ? "Pending retry QA" : "Pending QA");
    await settings(page).getByRole("button", { name: "Save Preferred name" }).click();
    await expect(settings(page).locator(".settings-status")).toHaveText("Saving…");
    await expect(name).toBeDisabled();
    await expect(settings(page).getByRole("button", { name: "Save Preferred name" })).toBeDisabled();
  } finally { release(); }
  await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
  await name.fill(original);
  await settings(page).getByRole("button", { name: "Save Preferred name" }).click();
  await expect(settings(page).locator(".settings-status")).toHaveText("Saved");
});

test("a rejected delete releases pending controls and retains the confirmation", async ({ page }) => {
  await login(page);
  await open(page, "Data & Privacy");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/chat**", async (route) => {
    if (route.request().headers()["next-action"] && route.request().postData()?.includes('"DELETE"')) {
      requests += 1;
      await gate;
      await route.abort("failed");
    } else await route.continue();
  });
  await settings(page).getByLabel("Type DELETE to confirm").fill("DELETE");
  await settings(page).getByRole("button", { name: "Delete all conversations", exact: true }).click();
  try { await expect(settings(page).getByRole("button", { name: "Deleting…", exact: true })).toBeDisabled(); }
  finally { release(); }
  await expect(settings(page).getByRole("alert")).toContainText("couldn't be deleted");
  await expect(settings(page).getByLabel("Type DELETE to confirm")).toHaveValue("DELETE");
  await expect(settings(page).getByRole("button", { name: "Delete all conversations", exact: true })).toBeEnabled();
  expect(requests).toBe(1);
});
