import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES } from "../../lib/attachments/limits";

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const fixture = (name: string) => ({ name, mimeType: name.endsWith(".md") ? "text/markdown" : "text/plain", buffer: readFileSync(`tests/fixtures/attachments/${name}`) });
const sized = (name: string, bytes: number, mimeType = "text/plain") => ({
  name,
  mimeType,
  buffer: Buffer.alloc(bytes, 65),
});

type Saved = { id: string; name: string; mimeType: string; sizeBytes: number; truncated: boolean; pageCount: null };

async function fulfillTus(route: Route) {
  const method = route.request().method();
  const reqHeaders = route.request().headers();
  const uploadLength = Number(reqHeaders["upload-length"] || 0);
  const headers = { "Tus-Resumable": "1.0.0", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Upload-Offset,Location,Tus-Resumable" };
  if (method === "OPTIONS") {
    await route.fulfill({
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "POST,HEAD,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "authorization,x-signature,tus-resumable,upload-length,upload-metadata,upload-offset,content-type",
      },
    });
    return;
  }
  if (method === "POST") {
    const bodyLen = route.request().postDataBuffer()?.byteLength ?? 0;
    await route.fulfill({
      status: 201,
      headers: {
        ...headers,
        Location: "https://storage.example/storage/v1/upload/resumable/sign/uploads/fake",
        "Upload-Offset": String(bodyLen > 0 && (!uploadLength || bodyLen >= uploadLength) ? (uploadLength || bodyLen) : bodyLen),
      },
      body: "",
    });
    return;
  }
  if (method === "HEAD") {
    await route.fulfill({ status: 200, headers: { ...headers, "Upload-Offset": String(uploadLength || 0) }, body: "" });
    return;
  }
  if (method === "PATCH") {
    const bodyLen = route.request().postDataBuffer()?.byteLength ?? 0;
    const prev = Number(reqHeaders["upload-offset"] || 0);
    const next = prev + bodyLen;
    await route.fulfill({
      status: 204,
      headers: { ...headers, "Upload-Offset": String(uploadLength && next >= uploadLength ? uploadLength : Math.max(next, 1)) },
      body: "",
    });
    return;
  }
  await route.fulfill({ status: 204, headers });
}

// The real workspace with its network edges faked: upload-init, TUS, finalize, message-save, reply stream.
async function workspace(page: Page, options: { failFirstFinalize?: boolean; rejectFinalize?: string } = {}) {
  const uploads: string[] = [];
  const removed: string[] = [];
  const cancelled: string[] = [];
  const tusCalls: string[] = [];
  const inits: Array<{ name: string; size: number }> = [];
  const sends: unknown[][] = [];
  let failures = options.failFirstFinalize ? 1 : 0;
  const sessions = new Map<string, { name: string; sizeBytes: number }>();

  await page.route("**/storage.example/**", async (route) => {
    tusCalls.push(route.request().method());
    await fulfillTus(route);
  });
  await page.route("**/api/chat/attachments/upload-init", async (route) => {
    const payload = route.request().postDataJSON() as { name?: string; size?: number; type?: string };
    const name = payload.name ?? "file";
    const size = Number(payload.size) || 0;
    inits.push({ name, size });
    if (size > MAX_ATTACHMENT_BYTES) {
      await route.fulfill({ status: 413, json: { error: "That file is larger than 10 MB." } });
      return;
    }
    const uploadId = crypto.randomUUID();
    sessions.set(uploadId, { name, sizeBytes: size || 62 });
    await route.fulfill({
      status: 201,
      json: {
        upload: {
          uploadId,
          path: `7c1f8a52-4f61-4d7e-9a3e-1b2c3d4e5f60/drafts/${uploadId}/${uploadId}.txt`,
          token: "tok",
          bucket: "chat-attachment-staging",
          tusEndpoint: "https://storage.example/storage/v1/upload/resumable/sign",
          contentType: name.endsWith(".md") ? "text/markdown" : "text/plain",
        },
      },
    });
  });
  await page.route("**/api/chat/attachments/finalize", async (route) => {
    const payload = route.request().postDataJSON() as { uploadId?: string; cancel?: boolean; abort?: boolean };
    if (payload.cancel || payload.abort) {
      if (payload.uploadId) cancelled.push(payload.uploadId);
      return route.fulfill({ json: { ok: true } });
    }
    const session = payload.uploadId ? sessions.get(payload.uploadId) : undefined;
    if (!session) return route.fulfill({ status: 409, json: { error: "An attachment is no longer available. Remove it and attach it again." } });
    if (options.rejectFinalize) {
      return route.fulfill({ status: 400, json: { error: options.rejectFinalize } });
    }
    if (failures > 0) { failures -= 1; return route.fulfill({ status: 503, json: { error: "We couldn't attach that file. Please try again." } }); }
    uploads.push(session.name);
    sessions.delete(payload.uploadId!);
    const attachment: Saved = {
      id: crypto.randomUUID(),
      name: session.name,
      mimeType: session.name.endsWith(".md") ? "text/markdown" : "text/plain",
      sizeBytes: session.sizeBytes,
      truncated: false,
      pageCount: null,
    };
    await route.fulfill({ status: 201, json: { attachment } });
  });
  await page.route("**/api/chat/attachments", async (route) => {
    const url = route.request().url();
    if (url.includes("/upload-init") || url.includes("/finalize") || /\/attachments\/[^/]+$/.test(url)) return route.fallback();
    await route.fulfill({ status: 410, json: { error: "Use /api/chat/attachments/upload-init, then finalize after the direct upload." } });
  });
  await page.route("**/api/chat/attachments/*", async (route) => {
    const url = route.request().url();
    if (url.includes("/upload-init") || url.includes("/finalize")) return route.fallback();
    removed.push(url.split("/").pop()!);
    await route.fulfill({ json: {} });
  });
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
  return { uploads, removed, cancelled, tusCalls, inits, sends };
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
  await expect(chips).toContainText(`Text · ${fixture("attachment-a.txt").buffer.byteLength} B`);
  await page.getByRole("button", { name: "Remove attachment-a.txt" }).click();
  await expect(page.locator(".attachment-chip")).toHaveCount(0);
  await expect.poll(() => server.removed.length).toBe(1);

  await attach(page, [fixture("attachment-a.txt"), fixture("attachment-b.md")]);
  await expect(page.locator(".attachment-chip.is-ready")).toHaveCount(2);
  expect(server.tusCalls.length).toBeGreaterThan(0);
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("What is the internal codename?");
  await page.getByRole("button", { name: "Send message" }).click();

  const userRow = page.locator(".message-row.user").first();
  await expect(userRow.getByRole("list", { name: "Attachments" })).toContainText("attachment-a.txt");
  await expect(userRow.getByRole("list", { name: "Attachments" })).toContainText("attachment-b.md");
  await expect(userRow.getByRole("link", { name: "Download attachment-a.txt" })).toHaveAttribute("href", /\/api\/chat\/attachments\/[0-9a-f-]+\/download$/i);
  await expect(userRow.getByRole("link", { name: "Download attachment-b.md" })).toHaveAttribute("href", /\/api\/chat\/attachments\/[0-9a-f-]+\/download$/i);
  await expect(userRow).toContainText("What is the internal codename?");
  await expect(page.locator(".message-row.assistant").first()).toContainText("Cedar Harbor");
  await expect(page.locator(".composer .attachment-chip")).toHaveCount(0);
  expect(server.sends[0]).toHaveLength(5);
  expect((server.sends[0][4] as string[])).toHaveLength(2);

  await page.getByRole("textbox", { name: "Message Nibie" }).fill("And when is the launch window?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant").nth(1)).toContainText("Tuesday morning");
  expect(server.sends[1]).toHaveLength(4);
  expect(server.uploads).toEqual(["attachment-a.txt", "attachment-a.txt", "attachment-b.md"]);

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
  const server = await workspace(page, { failFirstFinalize: true });
  const input = page.getByRole("textbox", { name: "Message Nibie" });
  await input.fill("Read this");
  await attach(page, [{ name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }, { name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }]);
  await expect(page.getByRole("alert").filter({ hasText: "photo.png: Images aren't supported yet." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "tool.exe: That file type isn't supported." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove photo.png" }).click();
  await page.getByRole("button", { name: "Remove tool.exe" }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

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

for (const bytes of [Math.floor(4.5 * 1024 * 1024), 5 * 1024 * 1024, 10 * 1024 * 1024]) {
  test(`accepts a ${bytes}-byte file through upload-init → TUS → finalize`, async ({ page }) => {
    const server = await workspace(page);
    await attach(page, [sized(`big-${bytes}.txt`, bytes)]);
    await expect(page.locator(".attachment-chip.is-ready")).toHaveCount(1);
    expect(server.inits).toEqual([{ name: `big-${bytes}.txt`, size: bytes }]);
    expect(server.uploads).toEqual([`big-${bytes}.txt`]);
    expect(server.tusCalls.length).toBeGreaterThan(0);
  });
}

test("rejects oversize and total oversize before upload-init", async ({ page }) => {
  const server = await workspace(page);
  await attach(page, [sized("too-big.txt", MAX_ATTACHMENT_BYTES + 1)]);
  await expect(page.getByRole("alert").filter({ hasText: "That file is larger than 10 MB." })).toBeVisible();
  expect(server.inits).toHaveLength(0);

  await page.getByRole("button", { name: "Remove too-big.txt" }).click();
  // 10 MiB + 10 MiB + 1 B exceeds the 20 MiB combined composer cap.
  await attach(page, [
    sized("a.txt", MAX_ATTACHMENT_BYTES),
    sized("b.txt", MAX_ATTACHMENT_BYTES),
    sized("c.txt", 1),
  ]);
  await expect(page.locator(".attachment-chip.is-ready, .attachment-chip.is-uploading")).toHaveCount(2);
  await expect(page.getByRole("alert").filter({ hasText: "Attachments can be up to 20 MB together." })).toBeVisible();
  expect(server.inits.length).toBeLessThanOrEqual(2);
  expect(server.inits.some((init) => init.name === "c.txt")).toBe(false);
  expect(MAX_ATTACHMENTS_TOTAL_BYTES).toBe(20 * 1024 * 1024);
});

test("invalid finalize extraction surfaces an error and does not send", async ({ page }) => {
  const server = await workspace(page, { rejectFinalize: "That file isn't readable text." });
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Read this");
  await attach(page, [fixture("attachment-a.txt")]);
  await expect(page.getByRole("alert").filter({ hasText: "That file isn't readable text." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(server.sends).toHaveLength(0);
});

test("removing while uploading cancels staging cleanup", async ({ page }) => {
  let releaseFinalize: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseFinalize = resolve; });
  const cancelled: string[] = [];
  await page.route("**/storage.example/**", fulfillTus);
  await page.route("**/api/chat/attachments/upload-init", async (route) => {
    const uploadId = "c0ffee00-0000-4000-8000-000000000099";
    await route.fulfill({
      status: 201,
      json: {
        upload: {
          uploadId,
          path: `user/drafts/${uploadId}/${uploadId}.txt`,
          token: "tok",
          bucket: "chat-attachment-staging",
          tusEndpoint: "https://storage.example/storage/v1/upload/resumable/sign",
          contentType: "text/plain",
        },
      },
    });
  });
  await page.route("**/api/chat/attachments/finalize", async (route) => {
    const payload = route.request().postDataJSON() as { uploadId?: string; cancel?: boolean };
    if (payload.cancel) {
      cancelled.push(payload.uploadId ?? "");
      return route.fulfill({ json: { ok: true } });
    }
    await gate;
    await route.fulfill({ status: 201, json: { attachment: { id: crypto.randomUUID(), name: "slow.txt", mimeType: "text/plain", sizeBytes: 4, truncated: false, pageCount: null } } });
  });
  await page.route("**/api/chat/attachments/*", async (route) => {
    if (route.request().url().includes("/upload-init") || route.request().url().includes("/finalize")) return route.fallback();
    await route.fulfill({ json: {} });
  });
  await page.goto("/preview/chat-core?workspace=1&mode=Balanced&conversation=" + conversation);
  await attach(page, [{ name: "slow.txt", mimeType: "text/plain", buffer: Buffer.from("slow") }]);
  await expect(page.locator(".attachment-chip.is-uploading")).toBeVisible();
  await page.getByRole("button", { name: "Remove slow.txt" }).click();
  releaseFinalize?.();
  await expect(page.locator(".attachment-chip")).toHaveCount(0);
  await expect.poll(() => cancelled.length).toBeGreaterThan(0);
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
    const tools = (await page.locator(".composer-actions").boundingBox())!;
    const chips = (await page.locator(".attachment-chips").boundingBox())!;
    expect(tools.y).toBeGreaterThanOrEqual(chips.y + chips.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  });
}

test("files dropped on the composer are attached like chosen ones", async ({ page }) => {
  const server = await workspace(page);
  const drag = (type: "dragover" | "drop") => page.evaluate((eventType) => {
    const data = new DataTransfer();
    data.items.add(new File(["Launch window: Tuesday morning."], "dropped.md", { type: "text/markdown" }));
    const event = new DragEvent(eventType, { dataTransfer: data, bubbles: true, cancelable: true });
    document.querySelector("form.composer-form")!.dispatchEvent(event);
    return event.defaultPrevented;
  }, type);
  await expect.poll(() => drag("dragover")).toBe(true);
  await expect(page.locator(".composer")).toHaveClass(/is-dropping/);
  expect(await drag("drop")).toBe(true);
  await expect(page.locator(".attachment-chip.is-ready")).toContainText("dropped.md");
  await expect(page.locator(".composer")).not.toHaveClass(/is-dropping/);
  expect(server.uploads).toEqual(["dropped.md"]);
});
