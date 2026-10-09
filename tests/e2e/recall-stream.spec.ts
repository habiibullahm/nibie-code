import { expect, test } from "@playwright/test";

for (const diagnosticEvent of ["start", "context"] as const) {
  test(`Memory diagnostics in ${diagnosticEvent} preserve a complete reply`, async ({ page }) => {
    await page.route("**/preview/chat-core**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (!route.request().headers()["next-action"]) return route.abort();
      const args: unknown[] = JSON.parse(route.request().postData()!);
      if (args.length !== 4) return route.abort();
      await route.fulfill({ contentType: "text/x-component", body: '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify({ data: { id: args[2], position: 1 } }) + "\n" });
    });
    const context = { sources: [{ type: "memory", label: "Saved memories", state: "included", reason: "A saved memory" }], recentMessageCount: 1 };
    const frame = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    const start = { id: "e3b624e6-d792-47a8-8ff2-46724452c1ca", position: 2 };
    await page.route("**/api/chat", (route) => route.fulfill({
      contentType: "text/event-stream",
      body: frame("start", diagnosticEvent === "start" ? { ...start, context } : start)
        + (diagnosticEvent === "context" ? frame("context", { context }) : "")
        + frame("delta", { text: "Here is the TypeScript example." })
        + frame("status", { status: "complete" }) + frame("done", {}),
    }));
    await page.goto("/preview/chat-core?workspace=1&conversation=5e9bdcca-9205-4fea-a773-13952bb78c44");
    await page.getByRole("textbox", { name: "Message Nibie" }).fill("Use my preferred language");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const assistant = page.locator(".message-row.assistant");
    await expect(assistant.locator(".markdown")).toContainText("Here is the TypeScript example.");
    await expect(assistant.getByRole("button", { name: "Copy response", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop response", exact: true })).toHaveCount(0);
    await expect(page.getByText(/couldn't complete|connection dropped|couldn't confirm/i)).toHaveCount(0);
  });
}
