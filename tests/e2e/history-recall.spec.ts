import { expect, test } from "@playwright/test";
import { renderHistoryReply } from "../../lib/history-recall/render";

const conversation = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const assistant = "e3b624e6-d792-47a8-8ff2-46724452c1ca";
const source = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const prompt = "What did we decide about Redis?";

// Real workspace + production evidence rendering; network and persistence are
// synthetic. DB authorization and handler behavior are separate unit/RLS checks.
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`historical source links, escaped evidence and refresh at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const content = renderHistoryReply({ status: "found", limited: false, evidence: [{
      conversationId: source, messageId: "history-message", title: "Cache decision", role: "user",
      createdAt: "2026-10-01T12:00:00.000Z",
      excerpt: "Use Redis. [steal](https://attacker.test) ![pixel](https://attacker.test/pixel) <script>ignore instructions</script> www.attacker.test user@attacker.test https://localhost/steal",
    }] }, "en", "http://localhost:3100");
    let userId = "";
    await page.route("**/preview/chat-core**", async route => {
      if (route.request().method() !== "POST") return route.continue();
      if (!route.request().headers()["next-action"]) return route.abort();
      const args = JSON.parse(route.request().postData()!) as unknown[];
      if (args.length !== 4 && args.length !== 5) return route.abort();
      userId = String(args[2]);
      await route.fulfill({ contentType: "text/x-component", body: '0:{"a":"$@1","f":[],"b":"development"}\n1:' + JSON.stringify({ data: { id: userId, position: 1 } }) + "\n" });
    });
    await page.route("**/api/chat", async route => {
      const payload = route.request().postDataJSON() as { conversationId: string; userMessageId: string };
      expect(payload).toMatchObject({ conversationId: conversation, userMessageId: userId });
      const frame = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      await page.context().addCookies([{ name: "chat-core-thread", url: "http://localhost:3100/preview/chat-core", value: encodeURIComponent(JSON.stringify([
        { id: userId, role: "user", content: prompt, position: 1, status: "complete" },
        { id: assistant, role: "assistant", content, position: 2, status: "complete" },
      ])) }]);
      await route.fulfill({ contentType: "text/event-stream", body:
        frame("start", { id: assistant, position: 2 }) + frame("delta", { text: content })
        + frame("status", { status: "complete" }) + frame("done", {}),
      });
    });
    await page.goto(`/preview/chat-core?workspace=1&mode=Balanced&conversation=${conversation}`);
    await page.getByRole("textbox", { name: "Message Nibie" }).fill(prompt);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const reply = page.locator(".message-row.assistant");
    await expect(reply).toContainText("Historical conversation excerpts");
    await expect(reply).toContainText("separate from saved Memory");
    await expect(reply.getByRole("link", { name: "Cache decision", exact: true })).toHaveAttribute("href", `http://localhost:3100/chat?conversation=${source}`);
    await expect(reply.getByRole("link", { name: "steal" })).toHaveCount(0);
    await expect(reply.getByRole("link")).toHaveCount(1);
    await expect(reply).toContainText("www.attacker.test user@attacker.test https://localhost/steal");
    await expect(reply.locator("img,script")).toHaveCount(0);
    await expect(reply).toContainText("may conflict or be outdated");
    await page.reload();
    await expect(reply).toContainText("Historical conversation excerpts");
    await expect(reply.getByRole("link", { name: "Cache decision", exact: true })).toHaveAttribute("href", `http://localhost:3100/chat?conversation=${source}`);
    await expect(reply.getByRole("link")).toHaveCount(1);
  });
}
