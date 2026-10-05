import { expect, test } from "@playwright/test";

test("desktop sidebar collapses to an accessible primary navigation rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/preview");

  const sidebar = page.locator(".desktop-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "264px");
  // Workbench is hidden from primary navigation for V1; its route and data are untouched.
  await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "64px");
  const expandSidebar = sidebar.getByRole("button", { name: "Expand sidebar" });
  await expect(expandSidebar).toHaveAttribute("aria-expanded", "false");
  await expect(expandSidebar.locator(".brand-mark")).toHaveCSS("opacity", "1");
  await expandSidebar.hover();
  await expect(expandSidebar.locator(".brand-mark")).toHaveCSS("opacity", "0");
  await expect(expandSidebar.locator(".rail-brand-toggle-icon")).toHaveCSS("opacity", "1");
  await expect(sidebar.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Rooms" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "General" })).toBeVisible();
  const railSettings = sidebar.getByRole("button", { name: "Settings" });
  await expect(railSettings).toBeVisible();
  await expect(sidebar.locator(".rail-secondary")).toHaveCount(0);
  const [footerBox, settingsBox, accountBox] = await Promise.all([
    sidebar.locator(".account-area").boundingBox(),
    railSettings.boundingBox(),
    sidebar.locator(".account-area .account-profile").boundingBox(),
  ]);
  expect(footerBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(accountBox).not.toBeNull();
  expect(settingsBox!.y).toBeGreaterThanOrEqual(footerBox!.y);
  expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(accountBox!.y);
  await expect(sidebar.locator(".account-profile")).toHaveAccessibleName("Account");
  await expect(sidebar.getByText("Today", { exact: true })).toHaveCount(0);
  await expect(sidebar.locator("[data-conversation-id]")).toHaveCount(0);

  await sidebar.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByTestId("welcome-greeting")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeFocused();
  await expect(sidebar).toHaveCSS("width", "64px");

  await sidebar.getByRole("button", { name: "Rooms" }).click();
  await expect(sidebar).toHaveCSS("width", "264px");
  await expect(sidebar.locator("section[aria-label='Rooms']")).toBeFocused();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await sidebar.getByRole("button", { name: "General" }).click();
  await expect(sidebar).toHaveCSS("width", "264px");
  await expect(sidebar.locator("section[aria-label='Chat history']")).toBeFocused();
  await sidebar.locator("[data-conversation-id='preview-writing'] .history-item").click();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "General" })).toHaveClass(/is-active/);
  await expect(railSettings).toBeVisible();
  expect((await railSettings.boundingBox())!.y).toBeCloseTo(settingsBox!.y, 0);
  await sidebar.getByRole("button", { name: "Rooms" }).click();
  await sidebar.locator("section[aria-label='Rooms'] .history-item").filter({ hasText: "Nibie Development" }).click();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "Rooms" })).toHaveClass(/is-active/);
  await expect(railSettings).toBeVisible();
  expect((await railSettings.boundingBox())!.y).toBeCloseTo(settingsBox!.y, 0);
  await sidebar.getByRole("button", { name: "Expand sidebar" }).click();

  await sidebar.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Settings" })).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Close settings" }).click();

  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await sidebar.locator(".account-profile").click();
  await expect(sidebar.locator(".account-profile")).toHaveAttribute("aria-expanded", "true");
  await sidebar.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "264px");
  await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "New chat" })).toBeVisible();
});

test("collapsed General navigation selects the latest General chat from a Room", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/preview");
  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await sidebar.getByRole("button", { name: "Rooms" }).click();
  await sidebar.locator("section[aria-label='Rooms'] .history-item").filter({ hasText: "Nibie Development" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Nibie Development");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await sidebar.getByRole("button", { name: "General" }).click();
  await expect(sidebar).toHaveCSS("width", "264px");
  await expect(sidebar.locator("[data-conversation-id='preview-writing'] .history-item")).toHaveClass(/is-active/);
  await expect(sidebar.locator("section[aria-label='Chat history'] .history-item.is-active")).toBeVisible();
  await expect(page.locator(".composer-secondary-tools").getByRole("button", { name: "Room: General" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "General" })).toHaveClass(/is-active/);
  await expect(sidebar.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("button", { name: "Rooms" })).not.toHaveClass(/is-active/);
  await expect(sidebar.getByRole("button", { name: "Rooms" })).not.toHaveAttribute("aria-current");
});

test("General navigation clears a draft when no General conversations remain", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/preview");
  const sidebar = page.locator(".desktop-sidebar");
  for (const title of ["A thoughtful note to the team", "Debouncing a search box"]) {
    await sidebar.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
    await page.getByRole("combobox", { name: "Move to", exact: true }).selectOption({ label: "Nibie Development" });
    await page.getByRole("button", { name: "Move thread", exact: true }).click();
  }
  await sidebar.getByRole("button", { name: "New thread in Nibie Development", exact: true }).click();
  const textarea = page.getByRole("textbox", { name: "Message Nibie" });
  await textarea.fill("Unsent text must not carry into a new chat.");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await sidebar.getByRole("button", { name: "General" }).click();
  await expect(textarea).toHaveValue("");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
});

test("sidebar keeps chat and Rooms available across desktop and mobile breakpoints", async ({ page }) => {
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/preview");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const sidebar = page.locator(".desktop-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
    await expect(sidebar.locator("section[aria-label='Rooms']")).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "New chat" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(sidebar).toHaveCSS("width", "64px");
    await expect(sidebar.getByRole("link", { name: "Workbench" })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "Rooms" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "New chat" })).toBeVisible();
  }

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator(".desktop-sidebar")).toBeHidden();
    await expect(page.getByRole("button", { name: "Open conversation menu" })).toBeVisible();
    await page.getByRole("button", { name: "Open conversation menu" }).click();
    const drawer = page.locator(".mobile-sidebar");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Workbench" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "New chat" })).toBeVisible();
    await expect(drawer.locator("section[aria-label='Rooms']")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Close menu" })).toBeVisible();
    await drawer.getByRole("button", { name: "Close menu" }).click();
    await expect(drawer).toHaveCount(0);
  }
});

test("chat history has no General classification and keeps its date groups", async ({ page }) => {
  await page.goto("/preview");
  const sidebar = page.locator(".desktop-sidebar");
  const history = sidebar.locator("section[aria-label='Chat history']");
  await expect(history.getByRole("button", { name: "A thoughtful note to the team", exact: true })).toBeVisible();
  await expect(history.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(sidebar.getByText("GENERAL", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /Hide chat list|Show chat list/ })).toHaveCount(0);
  await expect(sidebar.locator("section[aria-label='Rooms']")).toBeVisible();
});

test("Today, Yesterday, and Older chat lists collapse independently", async ({ page }) => {
  await page.goto("/preview");
  const history = page.locator("section[aria-label='Chat history']");
  const today = history.locator("section[aria-label='Today']");
  const older = history.locator("section[aria-label='Older']");

  await today.getByRole("button", { name: "Hide Today chats" }).click();
  await expect(today.getByRole("button", { name: "A thoughtful note to the team", exact: true })).toBeHidden();
  await expect(older.getByRole("button", { name: "Debouncing a search box", exact: true })).toBeVisible();
  await today.getByRole("button", { name: "Show Today chats" }).click();
  await expect(today.getByRole("button", { name: "A thoughtful note to the team", exact: true })).toBeVisible();

  await older.getByRole("button", { name: "Hide Older chats" }).click();
  await expect(older.getByRole("button", { name: "Debouncing a search box", exact: true })).toBeHidden();

  const yesterdayPage = await page.context().newPage();
  await yesterdayPage.addInitScript(() => {
    const currentTime = Date.now.bind(Date);
    Date.now = () => currentTime() + 86_400_000;
  });
  await yesterdayPage.goto("/preview");
  const shiftedHistory = yesterdayPage.locator("section[aria-label='Chat history']");
  const yesterday = shiftedHistory.locator("section[aria-label='Yesterday']");
  const shiftedOlder = shiftedHistory.locator("section[aria-label='Older']");
  await expect(yesterday.getByRole("button", { name: "A thoughtful note to the team", exact: true })).toBeVisible();
  await yesterday.getByRole("button", { name: "Hide Yesterday chats" }).click();
  await expect(yesterday.getByRole("button", { name: "A thoughtful note to the team", exact: true })).toBeHidden();
  await expect(shiftedOlder.getByRole("button", { name: "Debouncing a search box", exact: true })).toBeVisible();
  await shiftedOlder.getByRole("button", { name: "Hide Older chats" }).click();
  await expect(shiftedOlder.getByRole("button", { name: "Debouncing a search box", exact: true })).toBeHidden();
  await yesterdayPage.close();
});

test("sidebar conversation scrolling starts below the fixed New chat button", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview");
    if (width < 700) await page.getByRole("button", { name: "Open conversation menu" }).click();
    const sidebar = page.locator(width < 700 ? ".mobile-sidebar" : ".desktop-sidebar");
    const newChat = sidebar.getByRole("button", { name: "New chat", exact: true });
    const history = sidebar.getByRole("navigation", { name: "Conversations" });
    const [newChatBox, historyBox] = await Promise.all([newChat.boundingBox(), history.boundingBox()]);
    expect(newChatBox).not.toBeNull();
    expect(historyBox).not.toBeNull();
    expect(newChatBox!.y + newChatBox!.height).toBeLessThanOrEqual(historyBox!.y + 1);
    await expect(newChat).toHaveCSS("flex-shrink", "0");
  }
});

test("sidebar scroll is thin and does not move fixed controls on mobile or desktop", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 650 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/preview");
    if (viewport.width < 700) await page.getByRole("button", { name: "Open conversation menu" }).click();
    const sidebar = page.locator(viewport.width < 700 ? ".mobile-sidebar" : ".desktop-sidebar");
    const navigation = sidebar.getByRole("navigation", { name: "Conversations" });
    const newChat = sidebar.getByRole("button", { name: "New chat", exact: true });
    const account = sidebar.locator(".account-area");
    await navigation.evaluate((element) => { element.style.flex = "0 0 150px"; });
    const navBox = await navigation.boundingBox();
    const newChatBox = await newChat.boundingBox();
    const accountBox = await account.boundingBox();
    expect(navBox).not.toBeNull();
    expect(newChatBox).not.toBeNull();
    expect(accountBox).not.toBeNull();
    await expect(navigation).toHaveCSS("overflow-y", "auto");
    await expect(navigation).toHaveCSS("scrollbar-width", "thin");
    await expect(navigation).toHaveCSS("scrollbar-gutter", "stable");
    await expect.poll(() => navigation.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await navigation.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => navigation.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const newChatAfter = await newChat.boundingBox();
    const accountAfter = await account.boundingBox();
    expect(Math.abs(newChatAfter!.y - newChatBox!.y)).toBeLessThan(1);
    expect(Math.abs(accountAfter!.y - accountBox!.y)).toBeLessThan(1);
    expect(newChatBox!.y + newChatBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(accountBox!.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
});

test("Workbench remains directly routable behind sign-in", async ({ page }) => {
  await page.goto("/workbench");
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("room rows provide an accessible quick action to start a thread", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview");
    if (width < 700) await page.getByRole("button", { name: "Open conversation menu" }).click();
    const sidebar = page.locator(width < 700 ? ".mobile-sidebar" : ".desktop-sidebar");
    await sidebar.getByRole("button", { name: "New thread in Nibie Development" }).click();
    await expect(page.getByRole("heading", { name: "Nibie Development" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeFocused();
  }
});

test("Room action menu opens room details and is keyboard operable on desktop and mobile", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview");
    if (width < 700) await page.getByRole("button", { name: "Open conversation menu" }).click();
    const sidebar = page.locator(width < 700 ? ".mobile-sidebar" : ".desktop-sidebar");
    const trigger = sidebar.getByRole("button", { name: "Actions for Nibie Development" });
    const menu = sidebar.getByRole("menu", { name: "Actions for Nibie Development" });
    if (width >= 700) {
      const roomEntry = sidebar.locator("[data-room-id='preview-room-nibie'] .room-entry");
      await roomEntry.click({ button: "right", position: { x: 34, y: 16 } });
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      const entryBox = await roomEntry.boundingBox();
      expect(menuBox).not.toBeNull();
      expect(entryBox).not.toBeNull();
      expect(menuBox!.x).toBeGreaterThanOrEqual(entryBox!.x);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await trigger.click();
    await expect(menu.getByRole("menuitem", { name: "New thread" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Edit room" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete room" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await menu.getByRole("menuitem", { name: "Edit room" }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Nibie Development");
  }
});

test("Room action menu deletes a Room and moves its threads to General", async ({ page }) => {
  await page.goto("/preview");
  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: "Actions for Nibie Development" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await sidebar.getByRole("menu", { name: "Actions for Nibie Development" }).getByRole("menuitem", { name: "Delete room" }).click();

  await expect(sidebar.getByRole("button", { name: "Nibie Development", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("region", { name: "Chat history" }).getByRole("button", { name: "Learning the basics of astronomy", exact: true })).toBeVisible();
});

test("context opens from the composer icon and returns focus when dismissed", async ({ page }) => {
  await page.goto("/preview");
  const button = page.locator(".composer").getByRole("button", { name: "Context" });
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Context" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("What Nibie can use in this chat")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
});

test("context sources are clear and fit desktop and mobile widths", async ({ page }) => {
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/preview");
    await page.locator(".composer").getByRole("button", { name: "Context" }).click();
    const dialog = page.getByRole("dialog", { name: "Context" });
    await expect(dialog.getByRole("heading", { name: "Context" })).toBeVisible();

    const profile = dialog.locator(".context-source").filter({ hasText: "Your profile" });
    await expect(profile.locator(".context-source-status")).toHaveText("Empty");
    await expect(profile.getByRole("button", { name: "Edit profile" })).toBeVisible();
    const recent = dialog.locator(".context-source").filter({ hasText: "Recent conversation" });
    await expect(recent.locator(".context-source-status")).toHaveText("Empty");
    const summary = dialog.locator(".context-source").filter({ hasText: "Thread summary" });
    await expect(summary.locator(".context-source-status")).toHaveText("Not needed");
    await expect(summary).toContainText("Created when context gets long");

    const panelBox = await dialog.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(width);
    for (const row of await dialog.locator(".context-source").all()) {
      const titleBox = await row.locator("strong").boundingBox();
      const statusBox = await row.locator(".context-source-status").boundingBox();
      expect(titleBox).not.toBeNull();
      expect(statusBox).not.toBeNull();
      expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(statusBox!.x + 1);
      expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
  }
});

test("Room context and pins use the same source rows", async ({ page }) => {
  await page.goto("/preview");
  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: "New thread in Nibie Development" }).click();
  await page.locator(".composer").getByRole("button", { name: "Context" }).click();

  const dialog = page.getByRole("dialog", { name: "Context" });
  const roomSource = dialog.locator(".context-source").filter({ hasText: /^This room/ });
  const pinSource = dialog.locator(".context-source").filter({ hasText: /^Pinned context/ });
  await expect(roomSource.locator(".context-source-status")).toHaveText("Included");
  await expect(pinSource.locator(".context-source-status")).toHaveText("Included");
  await expect(dialog.locator(".context-source").filter({ hasText: "Recent conversation" }).locator(".context-source-status")).toHaveText("Empty");
  await expect(dialog.locator(".context-source").filter({ hasText: "File context" })).toHaveCount(0);
});

test("an existing conversation reports recent messages without inventing an active summary", async ({ page }) => {
  await page.goto("/preview");
  await page.locator(".desktop-sidebar").getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await page.locator(".composer").getByRole("button", { name: "Context" }).click();

  const dialog = page.getByRole("dialog", { name: "Context" });
  await expect(dialog.locator(".context-source").filter({ hasText: "Recent conversation" }).locator(".context-source-status")).toHaveText("Included");
  await expect(dialog.locator(".context-source").filter({ hasText: "Thread summary" }).locator(".context-source-status")).toHaveText("Not needed");
});

test("a long thread displays an active summary from response diagnostics", async ({ page }) => {
  const conversationId = "5e9bdcca-9205-4fea-a773-13952bb78c44";
  const userMessageIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  await page.context().addCookies([{ name: "chat-core-stop-snapshot", value: encodeURIComponent(JSON.stringify(userMessageIds)), domain: "localhost", path: "/" }]);
  await page.route("**/preview/chat-core**", async (route) => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    const args = JSON.parse(route.request().postData() ?? "[]") as unknown[];
    if (args.length !== 4) return route.abort();
    const result = { data: { id: args[2], position: 5 } };
    await route.fulfill({ contentType: "text/x-component", body: `0:{"a":"$@1","f":[],"b":"development"}\n1:${JSON.stringify(result)}\n` });
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, options) => {
      if (input !== "/api/chat") return originalFetch(input, options);
      const encoder = new TextEncoder();
      const event = (type: string, data: unknown) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      const context = { sources: [
        { type: "profile", label: "Your profile", state: "included", reason: "Preferred name" },
        { type: "recent_messages", label: "Recent conversation", state: "included", reason: "The latest messages in this thread." },
        { type: "thread_summary", label: "Thread summary", state: "included", reason: "Older parts of this conversation." },
      ], recentMessageCount: 4 };
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(event("start", { id: "e3b624e6-d792-47a8-8ff2-46724452c1ca", position: 6, context }));
        controller.enqueue(event("delta", { text: "The reply uses the existing summary." }));
        controller.enqueue(event("status", { status: "complete" }));
        controller.enqueue(event("done", {}));
        controller.close();
      } });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  });

  await page.goto(`/preview/chat-core?workspace=1&mode=Balanced&conversation=${conversationId}`);
  await expect(page.getByRole("textbox", { name: "Message Nibie" })).toBeVisible();
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Continue this conversation.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("The reply uses the existing summary.")).toBeVisible();
  await page.locator(".composer").getByRole("button", { name: "Context" }).click();

  const summary = page.getByRole("dialog", { name: "Context" }).locator(".context-source").filter({ hasText: /^Thread summary/ });
  await expect(summary.locator(".context-source-status")).toHaveText("Active");
  await expect(summary).toContainText("Older parts of this conversation.");
});

test("first-chat welcome and composer are centered together", async ({ page }) => {
  const greetings = ["Hey there.", "Good to see you.", "Welcome back.", "Glad you're here.", "Hello again."];
  for (const width of [390, 860, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/preview");
    const scroll = page.locator(".conversation-scroll.is-empty");
    const stack = scroll.locator(".welcome-state");
    await expect(stack.locator(".composer-dock.is-centered")).toBeVisible();
    const greeting = stack.getByTestId("welcome-greeting");
    await expect(greeting).toBeVisible();
    expect(greetings).toContain((await greeting.textContent())?.trim());
    await expect(stack.locator(".welcome-eyebrow")).toHaveCount(0);
    await expect(stack.locator(".suggestion-list")).toHaveCount(0);
    await expect(stack.locator(".welcome-icon")).toHaveCount(0);
    const [greetingBox, panelBox] = await Promise.all([greeting.boundingBox(), stack.locator(".welcome-panel").boundingBox()]);
    expect(greetingBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(Math.abs((greetingBox!.x + greetingBox!.width / 2) - (panelBox!.x + panelBox!.width / 2))).toBeLessThan(2);
    const composer = stack.locator(".composer-dock");
    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.y - (greetingBox!.y + greetingBox!.height)).toBeGreaterThanOrEqual(24);
    const scrollBox = await scroll.boundingBox();
    const stackBox = await stack.boundingBox();
    expect(scrollBox).not.toBeNull();
    expect(stackBox).not.toBeNull();
    expect(Math.abs((stackBox!.x + stackBox!.width / 2) - (scrollBox!.x + scrollBox!.width / 2))).toBeLessThan(2);
    expect(Math.abs((stackBox!.y + stackBox!.height / 2) - (scrollBox!.y + scrollBox!.height / 2))).toBeLessThan(2);
    await stack.getByRole("textbox", { name: "Message Nibie" }).fill("I'm typing now");
    await expect(greeting).toBeHidden();
    const [activeDockBox, mainBox] = await Promise.all([stack.locator(".composer-dock").boundingBox(), page.locator(".chat-main").boundingBox()]);
    expect(activeDockBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(Math.abs((activeDockBox!.y + activeDockBox!.height) - (mainBox!.y + mainBox!.height))).toBeLessThan(2);
  }
});

test("new chat cycles to a different welcome greeting", async ({ page }) => {
  const greetings = ["Hey there.", "Good to see you.", "Welcome back.", "Glad you're here.", "Hello again."];
  await page.goto("/preview");
  const greeting = page.getByTestId("welcome-greeting");
  await expect(greeting).toBeVisible();
  const first = (await greeting.textContent())?.trim();
  expect(greetings).toContain(first);
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect.poll(() => greeting.textContent()).not.toBe(first);
  expect(greetings).toContain((await greeting.textContent())?.trim());
});

test("active thread Room selector is in the composer", async ({ page }) => {
  await page.goto("/preview");
  await page.locator(".desktop-sidebar").getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await expect(page.locator(".chat-header .header-context")).toHaveCount(0);
  await expect(page.locator(".chat-header").getByRole("button", { name: "Create room" })).toHaveCount(0);
  await expect(page.locator(".desktop-sidebar").getByRole("button", { name: "New room", exact: true })).toBeVisible();
  const composer = page.locator(".composer-secondary-tools");
  const roomButton = composer.getByRole("button", { name: "Room: General" });
  await expect(roomButton).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Move thread" })).toHaveCount(0);
  await roomButton.click();
  const roomMenu = page.getByRole("menu", { name: "Select room" });
  await expect(roomMenu.getByText("Select room", { exact: true })).toBeVisible();
  await expect(roomMenu.getByText("Choose where this conversation belongs.", { exact: true })).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Nibie Development" }).click();
  await expect(composer.getByRole("button", { name: "Room: Nibie Development" })).toBeVisible();
});
