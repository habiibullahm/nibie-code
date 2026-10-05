import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    userStopHarness?: {
      requests: { body: { model: string; reasoning?: string; userMessageId: string }; signal: AbortSignal; aborted: boolean }[];
      releaseOldReader: () => void;
      completeSecond: () => void;
      confirmPartial: () => void;
      partialSaves: number;
    };
  }
}
const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";

async function workspace(page: Page, mode: string, stopFailure = false, holdModelSave = false) {
  let releaseModelSave!: () => void;
  const modelSaveGate = new Promise<void>((resolve) => { releaseModelSave = resolve; });
  let releaseStop!: () => void;
  const stopAck = new Promise<void>((resolve) => { releaseStop = resolve; });
  const actions: unknown[][] = [];
  const stops: unknown[] = [];
  // The Stop acknowledgement is a plain request, so a slow one cannot hold the Server Action queue.
  await page.route("**/api/chat/stop", async (route) => {
    stops.push(JSON.parse(route.request().postData()!));
    await stopAck;
    await route.fulfill(stopFailure
      ? { status: 503, json: { error: "We couldn't save that change. Please try again." } }
      : { json: {} });
  });
  await page.route("**/preview/chat-core**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    // Intercept the real workspace's Next action boundary; no DB action runs.
    if (!route.request().headers()["next-action"]) return route.abort();
    const args = JSON.parse(route.request().postData()!) as unknown[];
    actions.push(args);
    const modelUpdate = args.length === 2 && ["Fast", "Balanced", "High"].includes(args[1] as string);
    // Only the message save (and an explicit model choice) are Server Actions here; anything else is recorded and fails the Stop tests.
    if (args.length !== 4 && !modelUpdate) return route.abort();
    if (modelUpdate && holdModelSave) await modelSaveGate;
    const adds = actions.filter((action) => action.length === 4).length;
    const result = modelUpdate ? {} : { data: { id: args[2], position: adds * 2 - 1 } };
    await route.fulfill({ contentType: "text/x-component", body: '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify(result) + "\n" });
  });
  await page.addInitScript(() => {
    const original = window.fetch;
    const encoder = new TextEncoder();
    const frame = (type: string, data: unknown) => encoder.encode("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
    const state: NonNullable<Window["userStopHarness"]> = { requests: [], partialSaves: 0, releaseOldReader: () => {}, completeSecond: () => {}, confirmPartial: () => {} };
    window.userStopHarness = state;
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return original(input, options);
      const record = { body: JSON.parse(options!.body as string), signal: options!.signal!, aborted: false };
      state.requests.push(record);
      const count = state.requests.length;
      const id = count === 1 ? "e3b624e6-d792-47a8-8ff2-46724452c1ca" : "22222222-2222-4222-8222-222222222222";
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(frame("start", { id, position: count * 2 }));
          controller.enqueue(frame("delta", { text: count === 1 ? "Partial first response" : "Second response" }));
          record.signal.addEventListener("abort", () => {
            record.aborted = true;
            // Deliberately late reader cleanup and partial-save confirmation.
            state.releaseOldReader = () => controller.error(new DOMException("Stopped", "AbortError"));
            state.confirmPartial = () => { if (!state.partialSaves) state.partialSaves++; };
          }, { once: true });
          if (count === 2) state.completeSecond = () => {
            controller.enqueue(frame("delta", { text: " completed." }));
            controller.enqueue(frame("status", { status: "complete" }));
            controller.enqueue(frame("done", {})); controller.close();
          };
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  });
  await page.goto("/preview/chat-core?workspace=1&mode=" + mode + "&conversation=" + conversation);
  return { actions, stops, releaseStop, releaseModelSave };
}

for (const mode of ["Fast", "Balanced", "High"]) {
  test(mode + ": main workspace Stop allows Send before old persistence acknowledges", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const server = await workspace(page, mode);
    const input = page.getByRole("textbox", { name: "Message Nibie" });
    await input.fill("First synthetic prompt");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".message-row.assistant")).toContainText("Partial first response");
    await input.fill("Next before persistence confirmation");
    await page.getByRole("button", { name: "Stop response" }).click();
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    await expect(page.locator(".message-row.assistant")).toContainText("Stopped");
    await expect(page.locator(".message-row.assistant")).toContainText("Partial first response");
    expect(await page.evaluate(() => window.userStopHarness!.requests[0].signal.reason)).toBe("user_stopped");
    expect(await page.evaluate(() => window.userStopHarness!.requests[0].aborted)).toBe(true);
    expect(await page.evaluate(() => window.userStopHarness!.partialSaves)).toBe(0);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".message-row.assistant")).toHaveCount(2);
    await expect(page.locator(".message-row.assistant").last()).toContainText("Second response");
    const sends = server.actions.filter((args) => args.length === 4);
    expect(sends).toHaveLength(2);
    // Stop carries the reply it stopped and exactly the text on screen, both on the next save and on the acknowledgement.
    const stopped = { userMessageId: sends[0][2], assistantId: "e3b624e6-d792-47a8-8ff2-46724452c1ca", content: "Partial first response" };
    expect(sends[1][3]).toEqual([stopped]);
    // The next save ran while the Stop acknowledgement was still pending, and Stop never used the Server Action queue.
    expect(server.stops).toEqual([{ conversationId: conversation, ...stopped }]);
    expect(server.actions.filter((args) => args.length !== 4)).toEqual([]);
    expect(await page.evaluate(() => window.userStopHarness!.requests[1].signal.aborted)).toBe(false);
    await page.evaluate(() => window.userStopHarness!.releaseOldReader());
    // Late cleanup must not turn the new generation idle, abort it, or put it in recovery.
    await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
    expect(await page.evaluate(() => window.userStopHarness!.requests[1].signal.aborted)).toBe(false);
    await expect(page.locator(".message-row.assistant").first()).toContainText("Partial first response");
    server.releaseStop();
    await page.evaluate(() => {
      const ids = window.userStopHarness!.requests.map((request) => request.body.userMessageId);
      document.cookie = "chat-core-stop-snapshot=" + encodeURIComponent(JSON.stringify(ids)) + ";path=/preview/chat-core";
    });
    await input.fill("Third draft");
    await page.evaluate(() => window.userStopHarness!.completeSecond());
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
    // The refresh carries a stopped-status row whose partial content is not saved yet.
    await expect(page.locator(".message-row.assistant").first()).toContainText("Partial first response");
    await page.evaluate(() => window.userStopHarness!.confirmPartial());
    expect(await page.evaluate(() => window.userStopHarness!.partialSaves)).toBe(1);
    expect(await page.evaluate(() => window.userStopHarness!.requests.length)).toBe(2);
    await expect(page.locator(".message-row.user")).toHaveCount(2);
    await expect(page.locator(".message-row.assistant")).toHaveCount(2);
    // Reload from the saved snapshot keeps one stopped reply between the two turns.
    await page.evaluate(() => { document.cookie = "chat-core-stop-partial=1;path=/preview/chat-core"; });
    await page.reload();
    const rows = page.locator(".message-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("First synthetic prompt");
    await expect(rows.nth(1)).toContainText("Partial first response");
    await expect(rows.nth(1)).toContainText("Stopped");
    await expect(rows.nth(2)).toContainText("Next before persistence confirmation");
    await expect(rows.nth(3)).toContainText("Second response completed.");
    expect(errors).toEqual([]);
  });
}

test("a completed answer saved before Stop landed never replaces the stopped reply on screen (issue #12)", async ({ page }) => {
  const server = await workspace(page, "High");
  const input = page.getByRole("textbox", { name: "Message Nibie" });
  await input.fill("First synthetic prompt"); await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toContainText("Partial first response");
  await input.fill("Next before persistence confirmation"); await page.getByRole("button", { name: "Stop response" }).click();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toHaveCount(2);
  server.releaseStop();
  await page.evaluate(() => {
    const ids = window.userStopHarness!.requests.map((request) => request.body.userMessageId);
    document.cookie = "chat-core-stop-snapshot=" + encodeURIComponent(JSON.stringify(ids)) + ";path=/preview/chat-core";
    // The refresh after the next reply reads the first reply as the generation's finished answer.
    document.cookie = "chat-core-stop-partial=complete;path=/preview/chat-core";
  });
  await input.fill("Third draft");
  const refreshed = page.waitForResponse((response) => response.url().includes("/preview/chat-core") && response.request().headers()["rsc"] === "1");
  await page.evaluate(() => window.userStopHarness!.completeSecond());
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect(page.locator(".message-row.assistant").last()).toContainText("Second response completed.");
  // Let the refreshed server snapshot render before checking that it did not replace the stopped reply.
  await (await refreshed).finished();
  await page.waitForTimeout(500);
  const first = page.locator(".message-row.assistant").first();
  await expect(first).toContainText("Partial first response");
  await expect(first).toContainText("Stopped");
  await expect(first).not.toContainText("the rest of the finished answer");
});

test("failed background Stop acknowledgement preserves the partial and never re-locks the main composer", async ({ page }) => {
  const server = await workspace(page, "Fast", true);
  const input = page.getByRole("textbox", { name: "Message Nibie" });
  await input.fill("First"); await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toContainText("Partial first response");
  await input.fill("Second"); await page.getByRole("button", { name: "Stop response" }).click();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toHaveCount(2);
  server.releaseStop();
  await page.evaluate(() => window.userStopHarness!.releaseOldReader());
  await expect(page.getByText("We couldn't save that change. Please try again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  await input.fill("Third"); await page.evaluate(() => window.userStopHarness!.completeSecond());
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect(page.locator(".message-row.assistant").first()).toContainText("Partial first response");
});

test("the single picker sends the chosen mode and never a reasoning field", async ({ page }) => {
  const server = await workspace(page, "Balanced");
  const input = page.getByRole("textbox", { name: "Message Nibie" });
  await expect(page.getByRole("button", { name: "Model: Balanced", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^High/ }).click();
  await input.fill("First"); await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toContainText("Partial first response");
  await page.getByRole("button", { name: "Stop response" }).click();
  await page.getByRole("button", { name: "Model: High", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^Fast/ }).click();
  await input.fill("Second"); await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toHaveCount(2);
  const bodies = await page.evaluate(() => window.userStopHarness!.requests.map((request) => request.body));
  expect(bodies.map(({ model, ...rest }) => ({ model, hasReasoning: "reasoning" in rest }))).toEqual([
    { model: "High", hasReasoning: false }, { model: "Fast", hasReasoning: false },
  ]);
  expect(server.actions.filter((args) => args.length === 2).map((args) => args[1])).toEqual(["High", "Fast"]);
});

test("while a mode change saves, the picker says Saving… and never claims a response is running", async ({ page }) => {
  const server = await workspace(page, "Balanced", false, true);
  await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^Fast/ }).click();
  const saving = page.getByRole("button", { name: "Model: Fast (Saving…)", exact: true });
  await expect(saving).toBeDisabled();
  await expect(page.getByRole("button", { name: /A response is running/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /no models are configured/ })).toHaveCount(0);
  server.releaseModelSave();
  await expect(page.getByRole("button", { name: "Model: Fast", exact: true })).toBeEnabled();
});
