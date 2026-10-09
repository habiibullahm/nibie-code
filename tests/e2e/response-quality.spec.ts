import { expect, test, type Page } from "@playwright/test";

/**
 * Mocked Response Quality V2 UX coverage (Issue #73 / PR #77).
 * Intercepts `/api/chat` in the browser — no live provider spend.
 * Uses the chat-core workspace harness so MessageRow responding/waiting UI is real.
 */

declare global {
  interface Window {
    qualityStream?: {
      release: () => void;
      requests: { model: string; content: string }[];
    };
  }
}

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const modes = ["Fast", "Balanced", "High"] as const;
type Mode = (typeof modes)[number];

const answers: Record<Mode, string> = {
  Fast: "Fast mode reply: indexes speed equality lookups on hot columns.",
  Balanced: "Balanced mode reply: pick the index that matches the query filter and measure.",
  High: "High mode reply: prefer a composite index on (tenant_id, created_at) when that is the filter path; verify with EXPLAIN.",
};

async function mockQualityStream(page: Page, options: { holdBeforeFirstToken?: boolean } = {}) {
  await page.addInitScript(({ hold, answersByMode }) => {
    const original = window.fetch;
    const encoder = new TextEncoder();
    const frame = (type: string, data: unknown) =>
      encoder.encode("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { release, requests: [] as { model: string; content: string }[] };
    window.qualityStream = state;
    window.fetch = async (input, init) => {
      if (input !== "/api/chat") return original(input, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string; content?: string };
      const model = body.model === "Fast" || body.model === "High" || body.model === "Balanced" ? body.model : "Balanced";
      state.requests.push({ model, content: String(body.content ?? "") });
      const text = answersByMode[model];
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(frame("start", { id: "e3b624e6-d792-47a8-8ff2-46724452c1ca", position: 2 }));
          if (hold) await gate;
          else await new Promise((resolve) => setTimeout(resolve, 40));
          controller.enqueue(frame("delta", { text }));
          controller.enqueue(frame("status", { status: "complete" }));
          controller.enqueue(frame("done", {}));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    };
  }, { hold: Boolean(options.holdBeforeFirstToken), answersByMode: answers });
}

async function stubWorkspaceActions(page: Page) {
  await page.route("**/preview/chat-core**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (!route.request().headers()["next-action"]) return route.abort();
    const args = JSON.parse(route.request().postData()!) as unknown[];
    if (args.length !== 4) return route.abort();
    await route.fulfill({
      contentType: "text/x-component",
      body: '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify({ data: { id: args[2], position: 1 } }) + "\n",
    });
  });
}

for (const mode of modes) {
  test(`${mode}: mode selection, responding indicator, and non-empty completed assistant message`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await stubWorkspaceActions(page);
    await mockQualityStream(page, { holdBeforeFirstToken: true });
    await page.goto(`/preview/chat-core?workspace=1&mode=${mode}&conversation=${conversation}`);
    await expect(page.getByRole("button", { name: `Model: ${mode}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);

    await page.getByRole("textbox", { name: "Message Nibie" }).fill(`Explain indexes for ${mode}.`);
    await page.getByRole("button", { name: "Send message" }).click();

    const assistant = page.locator(".message-row.assistant");
    await expect(assistant).toHaveCount(1);
    const responding = assistant.locator(".visually-hidden[role='status']");
    await expect(responding).toHaveText("Nibie is responding");
    // High uses Thinking… before the first token; Fast/Balanced use Responding…
    await expect(assistant.locator(".response-thinking")).toHaveText(mode === "High" ? "Thinking…" : "Responding…");
    await expect(assistant.locator(".markdown")).toHaveCount(0);
    await expect(assistant.getByRole("button", { name: "Copy response" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();

    await page.evaluate(() => window.qualityStream!.release());
    await expect(assistant.locator(".markdown")).toContainText(answers[mode]);
    await expect(responding).toHaveCount(0);
    await expect(assistant.locator(".response-thinking")).toHaveCount(0);
    await expect(assistant.getByRole("button", { name: "Copy response" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

    const requests = await page.evaluate(() => window.qualityStream!.requests);
    expect(requests).toEqual([{ model: mode, content: `Explain indexes for ${mode}.` }]);
    expect(requests[0].content.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test("composer picker can switch Fast → Balanced → High and each completed reply stays non-empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubWorkspaceActions(page);
  await mockQualityStream(page);
  await page.goto(`/preview/chat-core?workspace=1&mode=Balanced&conversation=${conversation}`);

  for (const mode of modes) {
    await page.getByRole("button", { name: /^Model:/ }).click();
    await page.getByRole("menuitemradio", { name: new RegExp("^" + mode) }).click();
    await expect(page.getByRole("button", { name: `Model: ${mode}`, exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Message Nibie" }).fill(`Quality check ${mode}`);
    await page.getByRole("button", { name: "Send message" }).click();
    const assistant = page.locator(".message-row.assistant").last();
    await expect(assistant.locator(".markdown")).toContainText(answers[mode]);
    await expect(assistant.locator(".markdown")).not.toHaveText("");
    await expect(assistant.locator(".visually-hidden[role='status']")).toHaveCount(0);
    await expect(assistant.getByRole("button", { name: "Copy response" })).toBeVisible();
  }

  expect(await page.evaluate(() => window.qualityStream!.requests.map((row) => row.model))).toEqual([...modes]);
  expect(errors).toEqual([]);
});

test("chat-core fixture: Fast, Balanced, and High complete with visible non-empty assistant text", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    const records: { model: string; content: string }[] = [];
    Object.assign(window, { chatRequests: records });
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return original(input, options);
      const payload = JSON.parse(options!.body as string) as { model: string; content: string };
      records.push(payload);
      const encoder = new TextEncoder();
      const emit = (type: string, data: unknown) =>
        encoder.encode("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(emit("start", { id: "e3b624e6-d792-47a8-8ff2-46724452c1ca", position: 2 }));
          controller.enqueue(emit("delta", { text: `Completed ${payload.model} answer.` }));
          controller.enqueue(emit("status", { status: "complete" }));
          controller.enqueue(emit("done", {}));
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  });

  await page.goto("/preview/chat-core");
  for (const mode of modes) {
    await page.getByRole("button", { name: /^Model:/ }).click();
    await page.getByRole("menuitemradio", { name: new RegExp("^" + mode) }).click();
    await page.getByRole("textbox", { name: "Message Nibie" }).fill(`Fixture ${mode}`);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByLabel("Response status", { exact: true })).toHaveText("complete");
    await expect(page.getByLabel("Assistant text", { exact: true })).toHaveText(`Completed ${mode} answer.`);
    await expect(page.getByLabel("Assistant text", { exact: true })).not.toHaveText("");
  }
});
