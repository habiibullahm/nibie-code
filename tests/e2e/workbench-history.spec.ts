import { expect, test, type Page } from "@playwright/test";

const documentId = "6f0c1c3e-9a0b-4d1e-8f2a-1b2c3d4e5f60";
const oldVersion = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source: "manual", title: "Previous version",
  content: "## Original\n\n**Keputusan:** gunakan Redis.", document_revision: 1,
  revision_run_id: null, created_at: "2026-10-01T00:00:00.000Z",
};

/** UI contract fixture only; real atomic writes, retention and RLS run in the DB suite. */
async function stubHistory(page: Page, options: { restoreError?: boolean; saveDelay?: number; restoreDelay?: number; firstListFailure?: boolean } = {}) {
  let savedContent = "";
  const calls: string[] = [];
  await page.route("**/preview/workbench-v2", async route => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    const args = JSON.parse(route.request().postData() ?? "[]") as unknown[];
    const input = args[0] as { versionId?: string; expectedRevision?: number };
    let result: unknown;
    if (args.length === 2) {
      calls.push("save");
      if (options.saveDelay) await new Promise(resolve => setTimeout(resolve, options.saveDelay));
      const draft = args[1] as { title: string; content: string; expectedRevision: number };
      savedContent = draft.content;
      result = { data: { id: documentId, ...draft, revision: draft.expectedRevision + 1 } };
    } else if (typeof args[0] === "string") {
      calls.push("list");
      result = options.firstListFailure && calls.filter(call => call === "list").length === 1
        ? { error: "Version history could not be loaded." }
        : { data: [oldVersion] };
    } else if (input.versionId && input.expectedRevision) {
      calls.push("restore");
      if (options.restoreDelay) await new Promise(resolve => setTimeout(resolve, options.restoreDelay));
      result = options.restoreError
        ? { error: "We couldn't save that document. Please try again." }
        : { data: { id: documentId, title: oldVersion.title, content: oldVersion.content, revision: input.expectedRevision + 1 } };
    } else if (input.versionId) {
      calls.push("preview");
      result = { data: oldVersion };
    } else {
      calls.push("checkpoint");
      result = { data: oldVersion };
    }
    await route.fulfill({ contentType: "text/x-component", body: `0:{"a":"$@1","f":[],"b":"development"}\n1:${JSON.stringify(result)}\n` });
  });
  await page.route("**/api/workbench/documents/*/export?format=*", async route => {
    calls.push("export");
    await route.fulfill({ contentType: "text/plain; charset=utf-8", headers: { "content-disposition": "attachment; filename*=UTF-8''Catatan-Caf%C3%A9.txt" }, body: savedContent });
  });
  return { calls, savedContent: () => savedContent };
}

async function openHistory(page: Page) {
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  const dialog = page.getByRole("dialog", { name: "Version history" });
  await expect(dialog.getByRole("heading", { name: "Previous version" })).toBeVisible();
  return dialog;
}

for (const width of [1440, 390]) {
  test(`history supports keyboard preview and confirmed restore at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubHistory(page);
    await page.goto("/preview/workbench-v2");
    const history = await openHistory(page);
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      expect(await history.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    const bounds = await history.boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(history).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Document actions" })).toBeFocused();
    const reopened = await openHistory(page);
    page.once("dialog", dialog => dialog.dismiss());
    await reopened.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(reopened).toBeVisible();
    page.once("dialog", dialog => dialog.accept());
    await reopened.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(reopened).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Document", exact: true })).toHaveValue(oldVersion.content);
    await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue(oldVersion.title);
  });
}

test("failed restore keeps the current draft and the history dialog available", async ({ page }) => {
  const { calls } = await stubHistory(page, { restoreError: true, restoreDelay: 500 });
  await page.goto("/preview/workbench-v2");
  const body = page.getByRole("textbox", { name: "Document", exact: true });
  const before = await body.inputValue();
  const history = await openHistory(page);
  page.once("dialog", dialog => dialog.accept());
  await history.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(history.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(history).toBeVisible();
  await expect(history.getByRole("alert")).toContainText("couldn't save");
  await expect(body).toHaveValue(before);
  expect(calls.filter(call => call === "restore")).toHaveLength(1);
});

test("download waits for pending autosave and exports the visible Unicode draft", async ({ page }) => {
  const { calls, savedContent } = await stubHistory(page, { saveDelay: 700 });
  await page.goto("/preview/workbench-v2");
  const content = "Catatan Café — keputusan terbaru 日本語";
  await page.getByRole("textbox", { name: "Document", exact: true }).fill(content);
  await page.getByRole("button", { name: "Document actions" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download plain text" }).click();
  expect((await download).suggestedFilename()).toBe("Catatan-Café.txt");
  expect(savedContent()).toBe(content);
  expect(calls.indexOf("save")).toBeLessThan(calls.indexOf("export"));
});

test("formatted copy strips hidden reasoning and produces neutral safe HTML", async ({ page }) => {
  await stubHistory(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: {
      write: async (items: ClipboardItem[]) => {
        const html = await (await items[0].getType("text/html")).text();
        const plain = await (await items[0].getType("text/plain")).text();
        (window as unknown as { copied: { html: string; plain: string } }).copied = { html, plain };
      },
    } });
  });
  await page.goto("/preview/workbench-v2");
  await page.getByRole("textbox", { name: "Document", exact: true }).fill("<think>hidden reasoning</think>## Café\n\nHello **world**\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))");
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Copy formatted for Word/Docs" }).click();
  await expect(page.getByText("Copied for Word / Docs.")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copied: { html: string; plain: string } }).copied);
  expect(copied.plain).toContain("Hello world");
  expect(copied.html).toContain("<strong>world</strong>");
  expect(copied.html).not.toMatch(/hidden reasoning|<script|javascript:|var\(--|class=/);
});


test("history loading failure can be retried without losing the document", async ({ page }) => {
  await stubHistory(page, { firstListFailure: true });
  await page.goto("/preview/workbench-v2");
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history.getByRole("alert")).toContainText("could not be loaded");
  await history.getByRole("button", { name: "Retry loading history" }).click();
  await expect(history.getByRole("heading", { name: "Previous version" })).toBeVisible();
});
