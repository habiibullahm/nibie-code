import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const fixture = (name: string) => ({ name, mimeType: name.endsWith(".md") ? "text/markdown" : "text/plain", buffer: readFileSync(`tests/fixtures/attachments/${name}`) });

type Saved = { id: string; name: string; mimeType: string; sizeBytes: number; truncated: boolean; pageCount: null };

// The real workspace with its network edges faked: uploads, the message-save Server Action, and the reply stream.
async function workspace(page: Page, options: { failFirstUpload?: boolean } = {}) {
  const uploads: string[] = [];
  const removed: string[] = [];
  const sends: unknown[][] = [];
  let failures = options.failFirstUpload ? 1 : 0;
  await page.route("**/api/chat/attachments", async (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const name = /filename="([^"]+)"/.exec(body)?.[1] ?? "file";
    if (failures > 0) { failures -= 1; return route.fulfill({ status: 503, json: { error: "We couldn't attach that file. Please try again." } }); }
    uploads.push(name);
    const attachment: Saved = { id: crypto.randomUUID(), name, mimeType: name.endsWith(".md") ? "text/markdown" : "text/plain", sizeBytes: 62, truncated: false, pageCount: null };
    await route.fulfill({ status: 201, json: { attachment } });
  });
  await page.route("**/api/chat/attachments/*", async (route) => { removed.push(route.request().url().split("/").pop()!); await route.fulfill({ json: {} }); });
  await page.route("**/preview/chat-core**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (!route.request().headers()["next-action"]) return route.abort();
    const args = JSON.parse(route.request().postData()!) as unknown[];
    if (args.length !== 4 && args.length !== 5) return route.abort();
    sends.push(args);
    const result = { data: { id: args[2], position: sends.length * 2 - 1 } };
    await route.fulfill({ contentType: "text/x-component", body: '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify(result) + "\n" });
  });
  await page.addInitScript(() => {
    const original = window.fetch;
    const encoder = new TextEncoder();
    const frame = (type: string, data: unknown) => encoder.encode("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
    let count = 0;
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return original(input, options);
      count += 1;
      const answer = count === 1 ? "The codename is Cedar Harbor." : "The launch window is Tuesday morning.";
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(frame("start", { id: crypto.randomUUID(), position: count * 2, context: { sources: [{ type: "attachment", label: "Attachments", state: "included", reason: "Files attached in this conversation" }], recentMessageCount: 1 } }));
        controller.enqueue(frame("delta", { text: answer }));
        controller.enqueue(frame("status", { status: "complete" }));
        controller.enqueue(frame("done", {}));
        controller.close();
      } });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  });
  await page.goto("/preview/chat-core?workspace=1&mode=Balanced&conversation=" + conversation);
  return { uploads, removed, sends };
}

async function attach(page: Page, files: ReturnType<typeof fixture>[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach file", exact: true }).click();
  await (await chooser).setFiles(files);
}

test("attach, remove, attach again, send, follow up and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const server = await workspace(page);
  const chips = page.getByRole("list", { name: "Attachments" }).first();

  await attach(page, [fixture("attachment-a.txt")]);
  await expect(chips.getByText("attachment-a.txt")).toBeVisible();
  await expect(chips).toContainText("Text · 62 B");
  await page.getByRole("button", { name: "Remove attachment-a.txt" }).click();
  await expect(page.locator(".attachment-chip")).toHaveCount(0);
  await expect.poll(() => server.removed.length).toBe(1);

  await attach(page, [fixture("attachment-a.txt"), fixture("attachment-b.md")]);
  await expect(page.locator(".attachment-chip.is-ready")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("What is the internal codename?");
  await page.getByRole("button", { name: "Send message" }).click();

  const userRow = page.locator(".message-row.user").first();
  await expect(userRow.getByRole("list", { name: "Attachments" })).toContainText("attachment-a.txt");
  await expect(userRow.getByRole("list", { name: "Attachments" })).toContainText("attachment-b.md");
  await expect(userRow).toContainText("What is the internal codename?");
  await expect(page.locator(".message-row.assistant").first()).toContainText("Cedar Harbor");
  await expect(page.locator(".composer .attachment-chip")).toHaveCount(0);
  // The message and both attachment ids went to the save in one call.
  expect(server.sends[0]).toHaveLength(5);
  expect((server.sends[0][4] as string[])).toHaveLength(2);

  // A follow-up needs no new upload: it is a plain message, and the earlier attachments stay with their message.
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("And when is the launch window?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant").nth(1)).toContainText("Tuesday morning");
  expect(server.sends[1]).toHaveLength(4);
  expect(server.uploads).toEqual(["attachment-a.txt", "attachment-a.txt", "attachment-b.md"]);

  // Reload shows the saved attachment metadata on the user message.
  const [first] = server.sends as [string, string, string][];
  const attachments = [{ id: crypto.randomUUID(), name: "attachment-a.txt", mimeType: "text/plain", sizeBytes: 62, truncated: false, pageCount: null }, { id: crypto.randomUUID(), name: "attachment-b.md", mimeType: "text/markdown", sizeBytes: 47, truncated: false, pageCount: null }];
  await page.context().addCookies([{ name: "chat-core-thread", url: "http://localhost:3100/preview/chat-core", value: encodeURIComponent(JSON.stringify([
    { id: first[2], role: "user", content: "What is the internal codename?", status: "complete", position: 1, attachments },
    { id: crypto.randomUUID(), role: "assistant", content: "The codename is Cedar Harbor.", status: "complete", position: 2 },
  ])) }]);
  await page.reload();
  await expect(page.locator(".message-row.user").first().getByRole("list", { name: "Attachments" })).toContainText("attachment-b.md");
  expect(errors).toEqual([]);
});

test("unsupported files, images and failed uploads never send silently", async ({ page }) => {
  const server = await workspace(page, { failFirstUpload: true });
  const input = page.getByRole("textbox", { name: "Message Nibie" });
  await input.fill("Read this");
  await attach(page, [{ name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }, { name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }]);
  await expect(page.getByRole("alert").filter({ hasText: "photo.png: Images aren't supported yet." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "tool.exe: That file type isn't supported." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove photo.png" }).click();
  await page.getByRole("button", { name: "Remove tool.exe" }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

  // A failed upload blocks Send and keeps the draft; Retry recovers it.
  await attach(page, [fixture("attachment-a.txt")]);
  await expect(page.getByRole("alert").filter({ hasText: "attachment-a.txt: We couldn't attach that file." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expect(input).toHaveValue("Read this");
  await page.getByRole("button", { name: "Retry attachment-a.txt" }).click();
  await expect(page.locator(".attachment-chip.is-ready")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  expect(server.sends).toHaveLength(0);
});

test("no more than three attachments", async ({ page }) => {
  await workspace(page);
  await attach(page, [fixture("attachment-a.txt"), fixture("attachment-b.md"), fixture("attachment-a.txt"), fixture("attachment-b.md")]);
  await expect(page.locator(".attachment-chip")).toHaveCount(3);
  await expect(page.getByRole("alert").filter({ hasText: "You can attach up to 3 files." })).toBeVisible();
});

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`attachment chips fit the composer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await workspace(page);
    await attach(page, [{ name: `${"a-very-long-file-name-".repeat(5)}spec.md`, mimeType: "text/markdown", buffer: Buffer.from("# Notes\n\nLaunch window: Tuesday morning.") }, fixture("attachment-a.txt")]);
    await expect(page.locator(".attachment-chip.is-ready")).toHaveCount(2);
    const composer = (await page.locator(".composer").boundingBox())!;
    for (const chip of await page.locator(".attachment-chip").all()) {
      const box = (await chip.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(composer.x);
      expect(box.x + box.width).toBeLessThanOrEqual(composer.x + composer.width + 0.5);
    }
    // The action row stays below the text and chips, and the page never scrolls sideways.
    const tools = (await page.locator(".composer-tools").boundingBox())!;
    const chips = (await page.locator(".attachment-chips").boundingBox())!;
    expect(tools.y).toBeGreaterThanOrEqual(chips.y + chips.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  });
}

test("files dropped on the composer are attached like chosen ones", async ({ page }) => {
  const server = await workspace(page);
  // Real DragEvents built in the page, as a browser sends them while files are held over the composer.
  const drag = (type: "dragover" | "drop") => page.evaluate((eventType) => {
    const data = new DataTransfer();
    data.items.add(new File(["Launch window: Tuesday morning."], "dropped.md", { type: "text/markdown" }));
    const event = new DragEvent(eventType, { dataTransfer: data, bubbles: true, cancelable: true });
    document.querySelector("form.composer")!.dispatchEvent(event);
    return event.defaultPrevented;
  }, type);
  // Retried until the page has hydrated and the composer listens.
  await expect.poll(() => drag("dragover")).toBe(true);
  await expect(page.locator("form.composer")).toHaveClass(/is-dropping/);
  expect(await drag("drop")).toBe(true);
  await expect(page.locator(".attachment-chip.is-ready")).toContainText("dropped.md");
  await expect(page.locator("form.composer")).not.toHaveClass(/is-dropping/);
  expect(server.uploads).toEqual(["dropped.md"]);
});
