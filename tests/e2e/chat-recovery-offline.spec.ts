import { expect, test, type Page } from "@playwright/test";

// Exercise the real workspace against a synthetic persistence boundary. No auth,
// database or provider request runs; signed-in/RLS acceptance is a separate gate.
test.use({ trace: "retain-on-failure" });

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const firstReply = "e3b624e6-d792-47a8-8ff2-46724452c1ca";
const retriedReply = "22222222-2222-4222-8222-222222222222";
const url = `/preview/chat-core?workspace=1&mode=Balanced&conversation=${conversation}`;
type Failure = "disconnect" | "duplicate-start" | "late-delta" | "provider-error" | "held" | "complete";

declare global {
  interface Window {
    reliabilityRecovery?: {
      requests: { userMessageId: string; regenerate?: boolean; signalAborted: () => boolean }[];
      releaseLateCompletion: () => void;
    };
  }
}

async function mockWorkspace(page: Page, failure: Failure) {
  const actions: unknown[][] = [];
  const stops: unknown[] = [];
  await page.route("**/preview/chat-core**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (!route.request().headers()["next-action"]) return route.abort();
    const args = JSON.parse(route.request().postData()!) as unknown[];
    actions.push(args);
    if (args.length !== 4) return route.abort();
    await route.fulfill({ contentType: "text/x-component", body: '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify({ data: { id: args[2], position: 1 } }) + "\n" });
  });
  await page.route("**/api/chat/stop", async (route) => {
    const stop = JSON.parse(route.request().postData()!) as { userMessageId: string; assistantId: string; content: string };
    stops.push(stop);
    await page.context().addCookies([{ name: "chat-core-thread", domain: "localhost", path: "/", value: encodeURIComponent(JSON.stringify([
      { id: stop.userMessageId, role: "user", content: "Recovery prompt", position: 1, status: "complete" },
      { id: stop.assistantId, role: "assistant", content: stop.content, position: 2, status: "interrupted" },
    ])) }]);
    await route.fulfill({ json: {} });
  });
  await page.addInitScript(({ failure, firstReply, retriedReply }) => {
    const original = window.fetch;
    const encoder = new TextEncoder();
    const frame = (type: string, data: unknown) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const state: NonNullable<Window["reliabilityRecovery"]> = { requests: [], releaseLateCompletion: () => {} };
    window.reliabilityRecovery = state;
    const save = (userId: string, replyId: string, content: string, status: string) => {
      document.cookie = "chat-core-thread=" + encodeURIComponent(JSON.stringify([
        { id: userId, role: "user", content: "Recovery prompt", position: 1, status: "complete" },
        { id: replyId, role: "assistant", content, position: 2, status },
      ])) + ";path=/";
    };
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return original(input, options);
      const request = JSON.parse(options!.body as string) as { userMessageId: string; regenerate?: boolean };
      const signal = options!.signal!;
      state.requests.push({ ...request, signalAborted: () => signal.aborted });
      const initial = state.requests.length === 1 && !request.regenerate;
      const replyId = initial ? firstReply : retriedReply;
      const text = initial && failure !== "complete" ? "Kept partial" : "Recovered complete answer.";
      const saved = initial && ["disconnect", "duplicate-start", "late-delta"].includes(failure) ? "Recovered complete answer." : text;
      save(request.userMessageId, replyId, saved, initial && failure === "held" ? "streaming" : initial && failure === "provider-error" ? "error" : "complete");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(frame("start", { id: replyId, position: 2 }));
          controller.enqueue(frame("delta", { text }));
          if (initial && failure === "held") {
            state.releaseLateCompletion = () => {
              controller.enqueue(frame("delta", { text: " stale completion" }));
              controller.enqueue(frame("status", { status: "complete" }));
              controller.enqueue(frame("done", {}));
              controller.close();
            };
            return;
          }
          if (initial && failure === "disconnect") { controller.close(); return; }
          if (initial && failure === "duplicate-start") {
            controller.enqueue(frame("start", { id: retriedReply, position: 2 }));
          } else if (initial && failure === "provider-error") {
            controller.enqueue(frame("error", { error: "The provider reached its output limit. Please retry." }));
          } else {
            controller.enqueue(frame("status", { status: "complete" }));
            if (initial && failure === "late-delta") controller.enqueue(frame("delta", { text: " stale completion" }));
            controller.enqueue(frame("done", {}));
          }
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  }, { failure, firstReply, retriedReply });
  return { actions, stops };
}

for (const failure of ["disconnect", "duplicate-start", "late-delta", "provider-error"] as const) {
  test(`${failure}: recovery keeps one turn, permits a new attempt and survives reload`, async ({ page }) => {
    const server = await mockWorkspace(page, failure);
    await page.goto(url);
    await page.getByRole("textbox", { name: "Message Nibie" }).fill("Recovery prompt");
    await page.getByRole("button", { name: "Send message" }).click();
    const assistant = page.locator(".message-row.assistant");
    const retry = failure === "provider-error";
    await expect(page.getByRole("button", { name: retry ? "Retry" : "Regenerate", exact: true })).toBeEnabled();
    await expect(assistant).toHaveCount(1);
    await expect(page.locator(".message-row.user")).toHaveCount(1);
    await expect(assistant).toContainText(retry ? "Kept partial" : "Recovered complete answer.");
    await expect(assistant).not.toContainText("stale completion");
    if (retry) await expect(page.locator(".local-notice")).toContainText("output limit");
    else await expect(page.locator(".local-notice")).toHaveCount(0);
    await page.getByRole("button", { name: retry ? "Retry" : "Regenerate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeEnabled();
    await expect(assistant).toHaveCount(1);
    await expect(assistant).toContainText("Recovered complete answer.");
    await expect(page.locator(".local-notice")).toHaveCount(0);
    expect(server.actions).toHaveLength(1);
    const requests = await page.evaluate(() => window.reliabilityRecovery!.requests.map(({ userMessageId, regenerate }) => ({ userMessageId, regenerate: Boolean(regenerate) })));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({ userMessageId: requests[0].userMessageId, regenerate: true });
    await page.reload();
    await expect(assistant).toHaveCount(1);
    await expect(page.locator(".message-row.user")).toHaveCount(1);
    await expect(assistant).toContainText("Recovered complete answer.");
    expect(await page.evaluate(() => window.reliabilityRecovery!.requests.length)).toBe(0);
  });
}

test("a second tab observes Stop, retries the saved turn, and late first-tab frames stay stopped", async ({ page, context }) => {
  const sender = await mockWorkspace(page, "held");
  await page.goto(url);
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Recovery prompt");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message-row.assistant")).toContainText("Kept partial");
  const other = await context.newPage();
  const observer = await mockWorkspace(other, "complete");
  await other.goto(url);
  await expect(other.locator(".message-row.assistant [role='status']")).toHaveText("Nibie is responding");
  await expect(other.getByRole("button", { name: "Stop response" })).toHaveCount(0);
  expect(await other.evaluate(() => window.reliabilityRecovery!.requests.length)).toBe(0);
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect.poll(() => sender.stops.length).toBe(1);
  await expect(other.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(other.locator(".message-row.assistant")).toContainText("Stopped");
  await expect(other.locator(".message-row.assistant")).toContainText("Kept partial");
  await other.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(other.getByRole("button", { name: "Regenerate", exact: true })).toBeEnabled();
  await expect(other.locator(".message-row.assistant")).toHaveCount(1);
  await expect(other.locator(".message-row.user")).toHaveCount(1);
  expect(observer.actions).toEqual([]);
  const attempts = await other.evaluate(() => window.reliabilityRecovery!.requests.map(({ regenerate }) => Boolean(regenerate)));
  expect(attempts).toEqual([true]);
  await page.evaluate(() => window.reliabilityRecovery!.releaseLateCompletion());
  await expect(page.locator(".message-row.assistant")).toContainText("Stopped");
  await expect(page.locator(".message-row.assistant")).not.toContainText("stale completion");
  await page.reload();
  await expect(page.locator(".message-row.assistant")).toHaveCount(1);
  await expect(page.locator(".message-row.user")).toHaveCount(1);
  await expect(page.locator(".message-row.assistant")).toContainText("Recovered complete answer.");
});
