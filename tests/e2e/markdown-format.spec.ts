import { expect, test, type Page } from "@playwright/test";
import { formattingSampleId } from "../fixtures/formatting-sample";

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";

async function openSample(page: Page) {
  await page.context().addCookies([{ name: "chat-core-thread", url: "http://localhost:3100/preview/chat-core", value: encodeURIComponent(JSON.stringify([
    { id: crypto.randomUUID(), role: "user", content: "How does HTTP caching work?", status: "complete", position: 1 },
    { id: crypto.randomUUID(), role: "assistant", content: formattingSampleId, status: "complete", position: 2 },
  ])) }]);
  await page.goto(`/preview/chat-core?workspace=1&mode=Balanced&conversation=${conversation}`);
  await page.locator(".markdown h2").waitFor();
}

const layout = (page: Page) => page.evaluate(() => {
  const markdown = document.querySelector(".message-row.assistant .markdown")!;
  const size = (selector: string) => Number.parseFloat(getComputedStyle(markdown.querySelector(selector)!).fontSize);
  const code = markdown.querySelector(".code-block pre")!;
  const table = markdown.querySelector(".markdown-table")!;
  return {
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    markdownOverflow: markdown.scrollWidth - markdown.clientWidth,
    body: size("p"), listItem: size("li"), h2: size("h2"), h3: size("h3"), inlineCode: size("p code"),
    codeScrollsInside: code.scrollWidth > code.clientWidth,
    tableFrame: table.getBoundingClientRect().width, tableContent: table.scrollWidth, markdownWidth: markdown.clientWidth,
  };
});

for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900]] as const) {
  test(`assistant Markdown reads cleanly at ${width}px without widening the page`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openSample(page);
    const result = await layout(page);
    expect(result.pageOverflow).toBe(0);
    expect(result.markdownOverflow).toBe(0);
    // Chat-sized hierarchy: body 15.5px (Phase A), H2 at most ~17px, H3 between body and H2, inline code smaller than its text.
    expect(result.body).toBeGreaterThanOrEqual(14);
    expect(result.body).toBeLessThanOrEqual(15.5);
    expect(result.listItem).toBe(result.body);
    expect(result.h2).toBeLessThanOrEqual(17);
    expect(result.h2).toBeGreaterThan(result.h3);
    // H3: 15px desktop (under body); 16px mobile (between body 15.5 and H2 16.5).
    expect(result.h3).toBeGreaterThanOrEqual(15);
    if (width <= 760) expect(result.h3).toBeGreaterThanOrEqual(result.body);
    else expect(result.h3).toBeLessThanOrEqual(result.body);
    expect(result.inlineCode).toBeLessThan(result.body);
    // Long code lines scroll inside the block; the table never grows past the answer.
    expect(result.codeScrollsInside).toBe(true);
    expect(result.tableFrame).toBeLessThanOrEqual(result.markdownWidth + 0.5);
    if (width <= 390) expect(result.tableContent).toBeGreaterThan(result.tableFrame);
  });
}

test("assistant Markdown layout stays readable in light theme at desktop and phone widths", async ({ page }) => {
  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem("nibie-theme", "light"));
    await openSample(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("light");
    const result = await layout(page);
    expect(result.pageOverflow).toBe(0);
    expect(result.markdownOverflow).toBe(0);
    expect(result.codeScrollsInside).toBe(true);
    expect(result.tableFrame).toBeLessThanOrEqual(result.markdownWidth + 0.5);
  }
});

test("persisted formatting fixture keeps headings, lists, tables, and fences after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openSample(page);
  await page.reload();
  await page.locator(".markdown h2").waitFor();
  const structure = await page.evaluate(() => {
    const markdown = document.querySelector(".message-row.assistant .markdown")!;
    return {
      h2: markdown.querySelectorAll("h2").length,
      h3: markdown.querySelectorAll("h3").length,
      ol: markdown.querySelectorAll("ol").length,
      ul: markdown.querySelectorAll("ul").length,
      table: markdown.querySelectorAll("table").length,
      codeBlock: markdown.querySelectorAll(".code-block").length,
      text: markdown.textContent ?? "",
    };
  });
  expect(structure.h2).toBeGreaterThan(0);
  expect(structure.h3).toBeGreaterThan(0);
  expect(structure.ol).toBeGreaterThan(0);
  expect(structure.ul).toBeGreaterThan(0);
  expect(structure.table).toBe(1);
  expect(structure.codeBlock).toBe(1);
  expect(structure.text).toContain("Cache-Control");
  expect(structure.text).toContain("cachedFetch");
});

test("table cells never split a word or a code token on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSample(page);
  const splits = await page.evaluate(() => [...document.querySelectorAll(".markdown-table td code")].filter((code) => {
    const range = document.createRange();
    range.selectNodeContents(code);
    const rects = [...range.getClientRects()];
    // A token that wraps produces one rect per line; only tokens containing spaces may wrap.
    return rects.length > 1 && !/\s/.test(code.textContent ?? "");
  }).map((code) => code.textContent));
  expect(splits).toEqual([]);
});

test("a stray H1 is no larger than H2", async ({ page }) => {
  await page.goto(`/preview/chat-core?workspace=1&mode=Balanced&conversation=${conversation}`);
  const sizes = await page.evaluate(() => {
    const box = document.createElement("div");
    box.className = "markdown";
    box.innerHTML = "<h1>One</h1><h2>Two</h2>";
    document.body.append(box);
    return [...box.children].map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize));
  });
  expect(sizes[0]).toBeLessThanOrEqual(sizes[1]);
});

test("the code block Copy and Wrap controls copy the exact code and confirm it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSample(page);
  const copy = page.getByRole("button", { name: "Copy ts code block" });
  const wrap = page.getByRole("button", { name: "Wrap code" });
  await expect(copy.locator("svg.lucide-copy")).toBeVisible();
  await expect(copy).toContainText("Copy");
  await expect(wrap).toContainText("Wrap");
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await expect(wrap).toContainText("Unwrap");
  await copy.click();
  await expect(copy.locator("svg.lucide-check")).toBeVisible();
  await expect(copy).toContainText("Copied");
  await expect(copy).toHaveAttribute("title", "Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.startsWith("export async function cachedFetch(url: string, etag?: string)")).toBe(true);
  expect(copied.endsWith("}")).toBe(true);
  expect(copied).not.toContain("```");
});
