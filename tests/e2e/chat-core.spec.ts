import { expect, test, type Page } from "@playwright/test";

declare global { interface Window { chatRequests?: unknown[]; } }

test("one Send starts one request and Stop needs a subsequent explicit activation", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/chat", async (route) => { requests++; await new Promise((resolve) => setTimeout(resolve, 1500)); await route.fulfill({ status: 200, body: "" }).catch(() => {}); });
  await page.goto("/preview/chat-core");
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("One send");
  const send = await page.getByRole("button", { name: "Send message" }).elementHandle();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  expect(await send!.evaluate((element) => element.isConnected)).toBe(false);
  await expect(page.getByLabel("Requests", { exact: true })).toHaveText("1");
  await expect(page.getByLabel("Stops", { exact: true })).toHaveText("0");
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByLabel("Stops", { exact: true })).toHaveText("1");
});

test("a pointer activation begun on Send cannot become Stop after another submit input", async ({ page }) => {
  await page.route("**/api/chat", async (route) => { await new Promise((resolve) => setTimeout(resolve, 1500)); await route.fulfill({ status: 200, body: "" }).catch(() => {}); });
  await page.goto("/preview/chat-core");
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Single request");
  const box = await page.getByRole("button", { name: "Send message" }).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByLabel("Requests", { exact: true })).toHaveText("1");
  await expect(page.getByLabel("Stops", { exact: true })).toHaveText("0");
});

test("one capability picker: Fast, Balanced, High with product copy, default Balanced, no reasoning control", async ({ page }) => {
  await page.goto("/preview/chat-core");
  await expect(page.getByRole("button", { name: "Model: Balanced", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Model", exact: true }).getByRole("menuitemradio")).toHaveText([/^Fast\s*Quick answers/, /^Balanced\s*Best for everyday work/, /^High\s*Deeper reasoning/]);
  await page.getByRole("menuitemradio", { name: /^High/ }).click();
  await expect(page.getByRole("button", { name: "Model: High", exact: true })).toBeVisible();
  await expect(page.locator(".composer")).not.toContainText(/Reasoning|Low|Medium|Auto|GPT|DeepSeek|MiniMax|OpenAI/);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test("mode picker fits at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/preview");
    await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeVisible();
    for (const element of await page.locator(".composer-tools button").all()) {
      const box = await element.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const choice of [/^Fast/, /^Balanced/, /^High/]) {
      await page.getByRole("button", { name: /^Model:/ }).click();
      const menu = await page.getByRole("menu", { name: "Model", exact: true }).boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      await page.getByRole("menuitemradio", { name: choice }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
}


async function mockStream(page: Page, scenario: "complete" | "length" | "stop" | "network") {
  await page.addInitScript((firstScenario) => {
    const original = window.fetch;
    const records: Record<string, unknown>[] = [];
    Object.assign(window, { chatRequests: records });
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return original(input, options);
      records.push(JSON.parse(options!.body as string));
      const selected = records.length === 1 ? firstScenario : "complete";
      const encoder = new TextEncoder();
      const emit = (type: string, data: unknown) => encoder.encode("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(emit("start", { id: "e3b624e6-d792-47a8-8ff2-46724452c1ca", position: 2 }));
          controller.enqueue(emit("delta", { text: "Partial visible answer" }));
          options?.signal?.addEventListener("abort", () => { if (timer) clearTimeout(timer); controller.error(new DOMException("Aborted", "AbortError")); }, { once: true });
          if (selected === "stop") return;
          timer = setTimeout(() => {
            if (selected === "network") { controller.error(new Error("Network failed")); return; }
            if (selected === "length") controller.enqueue(emit("error", { error: "The model reached its output limit before finishing. Please retry or ask it to continue." }));
            else {
              controller.enqueue(emit("delta", { text: ". Complete." }));
              controller.enqueue(emit("status", { status: "complete" }));
            }
            controller.enqueue(emit("done", {})); controller.close();
          }, 30);
        },
        cancel() { if (timer) clearTimeout(timer); },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  }, scenario);
}

for (const scenario of ["length", "network", "stop"] as const) {
  test("partial text and composer recover from " + scenario, async ({ page }) => {
    await mockStream(page, scenario);
    await page.goto("/preview/chat-core");
    await page.getByRole("textbox", { name: "Message Nibie" }).fill("Detailed request");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByLabel("Assistant text", { exact: true })).toContainText("Partial visible answer");
    if (scenario === "stop") await page.getByRole("button", { name: "Stop response" }).click();
    await expect(page.getByLabel("Response status", { exact: true })).toHaveText(scenario === "stop" ? "interrupted" : "error");
    await expect(page.getByLabel("Assistant text", { exact: true })).toHaveText("Partial visible answer");
    if (scenario === "length") await expect(page.getByRole("status")).toContainText(["output limit", "Composer test fixture"]);
    if (scenario === "stop") await expect(page.getByText("Generation failed.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByLabel("Requests", { exact: true })).toHaveText("2");
    await expect(page.getByLabel("Response status", { exact: true })).toHaveText("complete");
    await expect(page.getByRole("button", { name: "Stop response" })).toHaveCount(0);
  });
}

test("Fast, Balanced and High each send only their mode; the client never names a provider or a reasoning effort", async ({ page }) => {
  await mockStream(page, "complete");
  await page.goto("/preview/chat-core");
  const choices = [["Fast", "Fast"], ["Balanced", "Balanced"], ["High", "High"], ["Fast", "Fast"]];
  for (const [label, model] of choices) {
    await page.getByRole("button", { name: /^Model:/ }).click();
    await page.getByRole("menuitemradio", { name: new RegExp("^" + label) }).click();
    await expect(page.getByRole("button", { name: "Model: " + label, exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Message Nibie" }).fill("Explain Room in detail with examples.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByLabel("Response status", { exact: true })).toHaveText("complete");
    expect(model).toBeTruthy();
  }
  expect(await page.evaluate(() => window.chatRequests)).toEqual([
    { content: "Explain Room in detail with examples.", model: "Fast" },
    { content: "Explain Room in detail with examples.", model: "Balanced" },
    { content: "Explain Room in detail with examples.", model: "High" },
    { content: "Explain Room in detail with examples.", model: "Fast" },
  ]);
});
