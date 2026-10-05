import { expect, test, type Page } from "@playwright/test";

const roomName = "Nibie Development";
const roomSelector = (page: Page) => page.getByRole("button", { name: /^Room:/ });
const newChat = (page: Page) => page.getByRole("button", { name: "New chat", exact: true }).filter({ visible: true }).first().click();
async function chooseRoom(page: Page, name: string) {
  await roomSelector(page).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}
async function send(page: Page, content: string) {
  await page.getByRole("textbox", { name: "Message Nibie" }).fill(content);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.beforeEach(async ({ page }) => { await page.goto("/preview"); });

test("new chat starts in General; initial selection survives typing and becomes the thread context", async ({ page }) => {
  await expect(roomSelector(page)).toHaveAccessibleName("Room: General");
  await expect(page.getByRole("textbox", { name: "Message Nibie" })).toHaveAttribute("placeholder", "Ask Nibie anything...");
  await send(page, "General hello");
  await expect(roomSelector(page)).toHaveAccessibleName("Room: General");
  await newChat(page);
  await chooseRoom(page, roomName);
  await page.getByRole("textbox", { name: "Message Nibie" }).fill("Room hello");
  await page.getByRole("button", { name: "Model: Balanced", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^Fast/ }).click();
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
  await newChat(page);
  await expect(roomSelector(page)).toHaveAccessibleName("Room: General");
  await page.locator('.desktop-sidebar [data-conversation-id]').filter({ hasText: "Room hello" }).locator(".history-item").click();
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
  await page.getByRole("button", { name: "Model: Fast", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^Balanced/ }).click();
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
});

test("room changes preserve the message draft and keyboard Escape restores focus", async ({ page }) => {
  const textbox = page.getByRole("textbox", { name: "Message Nibie" });
  await textbox.fill("Keep this draft");
  await roomSelector(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menu", { name: "Select room", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
  await expect(textbox).toHaveValue("Keep this draft");
  await roomSelector(page).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Select room", exact: true })).toHaveCount(0);
  await expect(roomSelector(page)).toBeFocused();
  await chooseRoom(page, "General");
  await expect(textbox).toHaveValue("Keep this draft");
  await send(page, "General again");
  await expect(roomSelector(page)).toHaveAccessibleName("Room: General");
});

test("an unavailable draft room blocks sending until a context is explicitly chosen", async ({ page }) => {
  await page.goto("/preview?room=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&draft=1");
  await expect(roomSelector(page)).toHaveAccessibleName("Room: Room unavailable");
  await send(page, "Keep this message");
  await expect(page.getByText("That room is no longer available. Choose General or another room before sending.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Nibie" })).toHaveValue("Keep this message");
  await expect(page.locator(".message-row.user")).toHaveCount(0);
  await chooseRoom(page, "General");
  await send(page, "Keep this message");
  await expect(roomSelector(page)).toHaveAccessibleName("Room: General");
});

test("the existing sidebar Room → New thread path still chooses the Room", async ({ page }) => {
  await page.locator(".desktop-sidebar [data-room-id]").getByRole("button", { name: roomName, exact: true }).click();
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
  await send(page, "Old flow hello");
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
});

test("no Rooms still offers General", async ({ page }) => {
  await page.locator(".desktop-sidebar [data-room-id]").getByRole("button", { name: roomName, exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete room", exact: true }).click();
  await roomSelector(page).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await send(page, "No rooms hello");
  await expect(page.getByLabel("Room context: General", { exact: true })).toBeVisible();
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`composer Plus, Room, mode picker, and send fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await chooseRoom(page, roomName);
    await expect(page.getByRole("button", { name: "Attach file", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Model:/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Reasoning:/ })).toHaveCount(0);
    const composer = page.locator(".composer");
    const textarea = page.getByRole("textbox", { name: "Message Nibie" });
    const composerBox = await composer.boundingBox();
    const textareaBox = await textarea.boundingBox();
    const actions = page.locator(".composer-actions");
    const actionsBox = await actions.boundingBox();
    const secondary = page.locator(".composer-secondary-tools");
    const secondaryBox = await secondary.boundingBox();
    expect(textareaBox!.y).toBeGreaterThanOrEqual(composerBox!.y);
    expect(actionsBox!.y).toBeGreaterThanOrEqual(composerBox!.y);
    expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(composerBox!.y + composerBox!.height);
    expect(secondaryBox!.y).toBeGreaterThanOrEqual(composerBox!.y + composerBox!.height);
    const plus = await page.getByRole("button", { name: "Attach file", exact: true }).boundingBox();
    const room = await roomSelector(page).boundingBox();
    const model = await page.getByRole("button", { name: /^Model:/ }).boundingBox();
    const sendButton = await page.getByRole("button", { name: "Send message", exact: true }).boundingBox();
    expect(plus!.x).toBeGreaterThanOrEqual(composerBox!.x);
    expect(plus!.x + plus!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width);
    expect(sendButton!.x + sendButton!.width).toBeLessThanOrEqual(composerBox!.x + composerBox!.width);
    expect(Math.abs(plus!.y + plus!.height / 2 - actionsBox!.y - actionsBox!.height / 2)).toBeLessThanOrEqual(1);
    expect(room!.y).toBeGreaterThanOrEqual(secondaryBox!.y);
    expect(room!.x).toBeGreaterThanOrEqual(0);
    expect(room!.x + room!.width).toBeLessThanOrEqual(width);
    if (Math.abs(model!.y - room!.y) < 4) {
      expect(room!.x + room!.width).toBeLessThanOrEqual(model!.x);
      expect(model!.x + model!.width).toBeLessThanOrEqual(width);
    } else {
      expect(width).toBeLessThanOrEqual(320);
      expect(model!.y).toBeGreaterThan(room!.y);
      expect(model!.x).toBeGreaterThanOrEqual(0);
      expect(model!.x + model!.width).toBeLessThanOrEqual(width);
    }
    await roomSelector(page).click();
    const menu = await page.getByRole("menu", { name: "Select room", exact: true }).boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Model:/ }).click();
    const modelMenu = await page.getByRole("menu", { name: "Model", exact: true }).boundingBox();
    expect(modelMenu!.x).toBeGreaterThanOrEqual(0);
    expect(modelMenu!.x + modelMenu!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  });
}

test("Room threads appear once and opening one expands its parent", async ({ page }) => {
  const sidebar = page.locator(".desktop-sidebar");
  const general = sidebar.getByRole("region", { name: "Chat history", exact: true });
  await expect(general.getByRole("button", { name: "Learning the basics of astronomy", exact: true })).toHaveCount(0);
  await sidebar.getByRole("button", { name: `Expand ${roomName}`, exact: true }).click();
  await expect(sidebar.getByRole("group", { name: `Threads in ${roomName}`, exact: true }).getByRole("button", { name: "Learning the basics of astronomy", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Learning the basics of astronomy", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: `Collapse ${roomName}`, exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.locator('[data-conversation-id="preview-learning"]')).toHaveCount(1);
  await sidebar.getByRole("button", { name: `Collapse ${roomName}`, exact: true }).click();
  await sidebar.getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  await sidebar.getByRole("button", { name: "Search conversations", exact: true }).click();
  await page.getByRole("searchbox").fill("Learning the basics of astronomy");
  await page.getByRole("dialog").getByRole("button", { name: "Learning the basics of astronomy", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: `Collapse ${roomName}`, exact: true })).toBeVisible();
});

test("desktop moves General → Room → another Room → General without changing messages", async ({ page }) => {
  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: "New room", exact: true }).click();
  await page.getByLabel("Room name", { exact: true }).fill("Clinic AI Assistant");
  await page.getByRole("button", { name: "Set up manually", exact: true }).click();
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await newChat(page);
  await send(page, "Help me draft pricing");
  const thread = sidebar.locator("[data-conversation-id]").filter({ hasText: "Help me draft pricing" });
  const messages = await page.locator(".message-row").allTextContents();
  const clinic = sidebar.locator("[data-room-id]").filter({ has: page.getByRole("button", { name: "Clinic AI Assistant", exact: true }) });
  await thread.dragTo(clinic);
  await expect(clinic.locator("[data-conversation-id]").filter({ hasText: "Help me draft pricing" })).toHaveCount(1);
  await expect(sidebar.getByRole("region", { name: "Chat history", exact: true }).locator("[data-conversation-id]").filter({ hasText: "Help me draft pricing" })).toHaveCount(0);
  await expect(roomSelector(page)).toHaveAccessibleName("Room: Clinic AI Assistant");
  expect(await page.locator(".message-row").allTextContents()).toEqual(messages);
  const otherRoom = sidebar.locator("[data-room-id]").filter({ has: page.getByRole("button", { name: roomName, exact: true }) });
  await thread.dragTo(otherRoom);
  await expect(otherRoom.locator("[data-conversation-id]").filter({ hasText: "Help me draft pricing" })).toHaveCount(1);
  await expect(clinic.locator("[data-conversation-id]")).toHaveCount(0);
  await expect(roomSelector(page)).toHaveAccessibleName(`Room: ${roomName}`);
  expect(await page.locator(".message-row").allTextContents()).toEqual(messages);
  await thread.dragTo(sidebar.getByRole("region", { name: "Chat history", exact: true }));
  await expect(sidebar.getByRole("region", { name: "Chat history", exact: true }).locator("[data-conversation-id]").filter({ hasText: "Help me draft pricing" })).toHaveCount(1);
  await expect(roomSelector(page)).toHaveAccessibleName("Room: General");
  expect(await page.locator(".message-row").allTextContents()).toEqual(messages);
});

test("mobile offers Move to without drag and drop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await send(page, "Mobile pricing");
  await page.getByRole("button", { name: "Open conversation menu", exact: true }).click();
  const sidebar = page.locator(".mobile-sidebar");
  const thread = sidebar.locator("[data-conversation-id]").filter({ hasText: "Mobile pricing" });
  await expect(thread).toHaveAttribute("draggable", "false");
  await sidebar.getByRole("button", { name: "Actions for Mobile pricing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
  await page.getByRole("combobox", { name: "Move to", exact: true }).selectOption({ label: roomName });
  await page.getByRole("button", { name: "Move thread", exact: true }).click();
  await expect(sidebar.getByRole("group", { name: `Threads in ${roomName}`, exact: true }).getByRole("button", { name: "Mobile pricing", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Actions for Mobile pricing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();
  await page.getByRole("combobox", { name: "Move to", exact: true }).selectOption({ label: "General" });
  await page.getByRole("button", { name: "Move thread", exact: true }).click();
  await expect(sidebar.getByRole("region", { name: "Chat history", exact: true }).getByRole("button", { name: "Mobile pricing", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Close menu", exact: true }).click();
  await expect(roomSelector(page)).toHaveAccessibleName("Room: General");
});

test("deleting a Room detaches its threads into General", async ({ page }) => {
  const sidebar = page.locator(".desktop-sidebar");
  await chooseRoom(page, roomName);
  await send(page, "Keep this room thread");
  await sidebar.getByRole("button", { name: roomName, exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete room", exact: true }).click();
  await expect(sidebar.getByRole("region", { name: "Chat history", exact: true }).getByRole("button", { name: "Keep this room thread", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("region", { name: "Chat history", exact: true }).getByRole("button", { name: "Learning the basics of astronomy", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Keep this room thread", exact: true }).click();
  await expect(page.getByLabel("Room context: General", { exact: true })).toBeVisible();
  await expect(page.locator(".message-row.user")).toContainText("Keep this room thread");
});
