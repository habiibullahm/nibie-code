import { expect, test, type Page } from "@playwright/test";
import { formattingSampleId } from "../fixtures/formatting-sample";

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";

async function openSample(page: Page) {
  await page.context().addCookies([{
    name: "chat-core-thread",
    url: "http://localhost:3100/preview/chat-core",
    value: encodeURIComponent(JSON.stringify([
      { id: crypto.randomUUID(), role: "user", content: "How does HTTP caching work?", status: "complete", position: 1 },
      { id: crypto.randomUUID(), role: "assistant", content: formattingSampleId, status: "complete", position: 2 },
    ])),
  }]);
  await page.goto(`/preview/chat-core?workspace=1&mode=Balanced&conversation=${conversation}`);
  await page.locator(".markdown h2").waitFor();
}

test("formatted copy writes html and plain clipboard payloads without Markdown markers", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSample(page);

  const copy = page.getByRole("button", { name: "Copy response" });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copy).toContainText("Copied");

  const payload = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items[0];
    const types = item.types.slice().sort();
    const plain = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : "";
    const html = item.types.includes("text/html") ? await (await item.getType("text/html")).text() : "";
    return { types, plain, html };
  });

  expect(payload.types).toEqual(expect.arrayContaining(["text/html", "text/plain"]));
  expect(payload.html).toContain("<h2");
  expect(payload.html).toContain("<table");
  expect(payload.html).toContain("<pre");
  expect(payload.html).toContain("cachedFetch");
  expect(payload.html).not.toContain("**");
  expect(payload.html).not.toContain("```");
  expect(payload.html).not.toMatch(/background:\s*#000|color:\s*#fff/i);
  expect(payload.html).toMatch(/background:transparent/);
  expect(payload.plain).toContain("How a request is answered");
  expect(payload.plain).toContain("1. The browser checks");
  expect(payload.plain).toContain("cachedFetch");
  expect(payload.plain).not.toContain("**");
  expect(payload.plain).not.toContain("```");
  expect(payload.plain).not.toContain("## ");
});

test("reply copy exposes a single control with no plain-text submenu", async ({ page }) => {
  await openSample(page);
  await expect(page.getByRole("button", { name: "Copy response" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More copy options" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Copy plain text" })).toHaveCount(0);
});

test("formatted copy falls back to plain text when ClipboardItem write is denied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSample(page);

  await page.evaluate(() => {
    const original = navigator.clipboard;
    const writeText = (text: string) => original.writeText(text);
    const readText = () => original.readText();
    const read = () => original.read();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => { throw new Error("denied"); },
        writeText,
        read,
        readText,
      },
    });
  });

  await page.getByRole("button", { name: "Copy response" }).click();
  await expect(page.getByRole("button", { name: "Copy response" })).toContainText("Copied");
  const plain = await page.evaluate(() => navigator.clipboard.readText());
  expect(plain).toContain("HTTP caching");
  expect(plain).not.toContain("**");
});

test("code-block copy still copies exact code text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSample(page);
  const copy = page.getByRole("button", { name: "Copy ts code block" });
  await copy.click();
  await expect(copy).toContainText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.startsWith("export async function cachedFetch")).toBe(true);
  expect(copied).not.toContain("```");
});
