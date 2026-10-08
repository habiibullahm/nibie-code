import { expect, test, type Page } from "@playwright/test";
import { longReplyEnd, longReplyFixtureId, longReplyParts } from "../fixtures/long-reply";

declare global {
  interface Window { highStream?: { release: () => void; requests: number }; loadedOnce?: boolean }
}
const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const reply = "e3b624e6-d792-47a8-8ff2-46724452c1ca";
const userMessage = "b79e56e1-b479-46f4-97d3-30b2e22be90e";
const prompt = "Design the smallest useful Agent Foundation V1 for Nibie. Explain tradeoffs and what not to build yet.";

// The saved thread the dev harness renders after a reload or a refresh (see app/preview/chat-core/page.tsx).
async function saveThread(page: Page, userId: string, assistant: { content: string; status: string }) {
  await page.context().addCookies([{ name: "chat-core-thread", url: "http://localhost:3100/preview/chat-core", value: encodeURIComponent(JSON.stringify([
    { id: userId, role: "user", content: prompt, status: "complete", position: 1 },
    { id: reply, role: "assistant", position: 2, ...assistant },
  ])) }]);
}

async function workspace(page: Page) {
  const saves: string[] = [];
  await page.route("**/preview/chat-core**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (!route.request().headers()["next-action"]) return route.abort();
    const args = JSON.parse(route.request().postData()!) as unknown[];
    if (args.length !== 4) return route.abort();
    saves.push(args[2] as string);
    await route.fulfill({ contentType: "text/x-component", body: '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify({ data: { id: args[2], position: 1 } }) + "\n" });
  });
  await page.addInitScript((parts) => {
    const original = window.fetch;
    const encoder = new TextEncoder();
    const frame = (type: string, data: unknown) => encoder.encode("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
    let release!: () => void;
    const halfway = new Promise<void>((resolve) => { release = resolve; });
    const state = { release, requests: 0 };
    window.highStream = state;
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return original(input, options);
      state.requests += 1;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(frame("start", { id: "e3b624e6-d792-47a8-8ff2-46724452c1ca", position: 2 }));
          // High reasoning: a silent stretch before the first token.
          await new Promise((resolve) => setTimeout(resolve, 800));
          for (const [index, text] of parts.entries()) {
            if (index === Math.floor(parts.length / 2)) await halfway;
            // Each frame arrives in two network chunks, splitting multi-byte characters where they fall.
            const bytes = frame("delta", { text });
            const cut = Math.floor(bytes.length / 2);
            controller.enqueue(bytes.slice(0, cut)); controller.enqueue(bytes.slice(cut));
            await new Promise((resolve) => setTimeout(resolve, 2));
          }
          controller.enqueue(frame("status", { status: "complete" }));
          controller.enqueue(frame("done", {}));
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  }, longReplyParts);
  return saves;
}

test("a long High reply streams, settles idle with Copy, and the saved text survives a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const saves = await workspace(page);
  await page.goto("/preview/chat-core?workspace=1&mode=High&conversation=" + conversation);
  await page.getByRole("textbox", { name: "Message Nibie" }).fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  const assistant = page.locator(".message-row.assistant");

  // Streamed tokens render while the generation is live.
  await expect(assistant).toContainText("Building block 1");
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  // SR responding copy is visually-hidden (clip); Chromium drops it from the accessible name, so assert the DOM node.
  const responding = assistant.locator(".visually-hidden[role='status']");
  await expect(responding).toHaveText("Nibie is responding");
  await expect(assistant.getByRole("button", { name: "Copy response" })).toHaveCount(0);

  await page.evaluate(() => window.highStream!.release());
  await expect(assistant).toContainText(longReplyEnd);
  // The generation is idle: no Stop, no responding indicator, Copy available, and the composer accepts the next message.
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
  await expect(responding).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Copy response" })).toBeVisible();
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Thanks");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  const finalText = await assistant.locator(".message-content").innerText();

  // After a reload the persisted reply is the same text, still finished.
  await saveThread(page, saves[0], { content: longReplyFixtureId, status: "complete" });
  await page.reload();
  await expect(assistant).toHaveCount(1);
  await expect(assistant.getByRole("button", { name: "Copy response" })).toBeVisible();
  expect(await assistant.locator(".message-content").innerText()).toBe(finalText);
  expect(await page.evaluate(() => window.highStream!.requests)).toBe(0);
  expect(errors).toEqual([]);
});

test("a reply still generating when the thread loads settles from the server without a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await saveThread(page, userMessage, { content: "…", status: "streaming" });
  await page.goto("/preview/chat-core?workspace=1&mode=High&conversation=" + conversation);
  await page.evaluate(() => { window.loadedOnce = true; });
  const assistant = page.locator(".message-row.assistant");
  // The claim placeholder reads as the responding indicator, never as a literal "…" answer.
  const responding = assistant.locator(".visually-hidden[role='status']");
  await expect(responding).toHaveText("Nibie is responding");
  await expect(assistant.locator(".message-content")).not.toContainText("…");
  await expect(assistant.getByRole("button", { name: "Copy response" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);

  // The server finishes the reply (another tab, or a stream this page lost); the open page picks it up by itself.
  await saveThread(page, userMessage, { content: longReplyFixtureId, status: "complete" });
  await expect(assistant).toContainText(longReplyEnd, { timeout: 15_000 });
  await expect(responding).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Copy response" })).toBeVisible();
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Next");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  expect(await page.evaluate(() => window.loadedOnce)).toBe(true);
  expect(errors).toEqual([]);
});
