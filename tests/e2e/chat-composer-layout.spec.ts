import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1440, height: 650 },
  { width: 768, height: 700 },
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
  { width: 390, height: 650 },
  { width: 320, height: 568 },
];

async function openSampleConversation(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/preview");
  if (width <= 760) {
    await page.getByRole("button", { name: "Open conversation menu" }).click();
    await page.locator(".mobile-sidebar").getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  } else {
    await page.locator(".desktop-sidebar").getByRole("button", { name: "A thoughtful note to the team", exact: true }).click();
  }
  await expect(page.locator(".conversation-scroll.has-messages .message-row").last()).toBeVisible();
  const scroll = page.locator(".conversation-scroll.has-messages");
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(1);
}

async function expectComposerGeometry(page: Page) {
  const metrics = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".conversation-scroll.has-messages")!;
    const dock = document.querySelector<HTMLElement>(".chat-main > .composer-dock")!;
    const composer = dock.querySelector<HTMLElement>(".composer")!;
    const actions = composer.querySelector<HTMLElement>(".composer-actions")!;
    const attach = composer.querySelector<HTMLElement>(".composer-attach button")!;
    const message = viewport.querySelector<HTMLElement>(".message-row:last-child")!;
    const textarea = dock.querySelector<HTMLTextAreaElement>("textarea")!;
    return {
      viewportBottom: viewport.getBoundingClientRect().bottom,
      composerTop: dock.getBoundingClientRect().top,
      composerBottom: dock.getBoundingClientRect().bottom,
      textareaBottom: textarea.getBoundingClientRect().bottom,
      actionsTop: actions.getBoundingClientRect().top,
      actionsBottom: actions.getBoundingClientRect().bottom,
      attachTop: attach.getBoundingClientRect().top,
      attachBottom: attach.getBoundingClientRect().bottom,
      showsPlaceholderAsText: composer.textContent?.includes("Ask Nibie anything...") ?? false,
      composerBoxBottom: composer.getBoundingClientRect().bottom,
      messageBottom: message.getBoundingClientRect().bottom,
      textareaHeight: textarea.getBoundingClientRect().height,
      textareaClientHeight: textarea.clientHeight,
      textareaScrollHeight: textarea.scrollHeight,
      textareaScrollbarWidth: getComputedStyle(textarea).scrollbarWidth,
      maxTextareaHeight: Number.parseFloat(getComputedStyle(textarea).maxHeight),
      viewportHeight: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  expect(metrics.viewportBottom).toBeLessThanOrEqual(metrics.composerTop + 1);
  expect(metrics.messageBottom).toBeLessThanOrEqual(metrics.viewportBottom + 1);
  expect(metrics.composerBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.showsPlaceholderAsText).toBe(false);
  expect(metrics.textareaBottom).toBeLessThanOrEqual(metrics.actionsTop + 1);
  expect(Math.abs(metrics.attachTop + (metrics.attachBottom - metrics.attachTop) / 2 - metrics.actionsTop - (metrics.actionsBottom - metrics.actionsTop) / 2)).toBeLessThanOrEqual(1);
  expect(metrics.actionsBottom).toBeLessThanOrEqual(metrics.composerBoxBottom + 1);
  if (Number.isFinite(metrics.maxTextareaHeight)) expect(metrics.textareaHeight).toBeLessThanOrEqual(metrics.maxTextareaHeight + 2);
  expect(metrics.horizontalOverflow).toBe(false);
  return metrics;
}

test("growing composer stays below messages at desktop, tablet, and mobile sizes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const { width, height } of viewports) {
    await openSampleConversation(page, width, height);
    const textarea = page.getByRole("textbox", { name: "Message Nibie" });
    const initialHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
    expect(await textarea.getAttribute("rows")).toBe("1");
    // Single-line composer: 15px desktop / 16px mobile type sits a little taller than the old 13px baseline.
    expect(initialHeight).toBeLessThanOrEqual(40);

    await textarea.fill("A one-line prompt");
    await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(initialHeight);
    const oneLineHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
    expect(oneLineHeight).toBeLessThanOrEqual(initialHeight + 1);

    await textarea.fill(Array.from({ length: 3 }, (_, index) => `Prompt line ${index + 1}`).join("\n"));
    await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(oneLineHeight);
    const threeLineHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);

    await textarea.fill(Array.from({ length: 5 }, (_, index) => `Prompt line ${index + 1}`).join("\n"));
    await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(threeLineHeight);
    const fiveLineHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);

    await textarea.fill(Array.from({ length: 10 }, (_, index) => `Prompt line ${index + 1}`).join("\n"));
    await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(fiveLineHeight);
    const tenLineHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);

    const longPrompt = Array.from({ length: 80 }, (_, index) => `const value${index + 1} = "line ${index + 1}: explain the decision and fallback behavior";`).join("\n");
    await textarea.fill("");
    await page.evaluate((text) => navigator.clipboard.writeText(text), longPrompt);
    await textarea.click();
    await page.keyboard.press("Control+V");
    await expect(textarea).toHaveValue(longPrompt);
    await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(tenLineHeight);
    await expect.poll(() => page.locator(".conversation-scroll.has-messages").evaluate((element) => element.querySelector<HTMLElement>(".message-row:last-child")!.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
    const metrics = await expectComposerGeometry(page);
    expect(metrics.textareaScrollHeight).toBeGreaterThan(metrics.textareaClientHeight);
    expect(metrics.textareaScrollbarWidth).toBe("thin");
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach file" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Room:/ })).toBeVisible();

    const modelButton = page.getByRole("button", { name: /^Model:/ });
    await modelButton.click();
    await expect(page.getByRole("menu", { name: "Model" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Model" })).toHaveCount(0);
  }
});

test("expand affordance tracks actual textarea overflow", async ({ page }) => {
  await openSampleConversation(page, 733, 650);
  const textarea = page.getByRole("textbox", { name: "Message Nibie" });
  const expand = page.getByRole("button", { name: "Expand composer" });
  await expect(expand).toHaveCount(0);
  await textarea.fill("Short draft");
  await expect(expand).toHaveCount(0);
  const shortDraftHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
  await textarea.fill(Array.from({ length: 20 }, (_, i) => `Prompt line ${i + 1}`).join("\n"));
  await expect(expand).toBeVisible();
  const actions = page.locator(".composer-actions");
  const [actionsBox, expandBox] = await Promise.all([actions.boundingBox(), expand.boundingBox()]);
  expect(actionsBox).not.toBeNull();
  expect(expandBox).not.toBeNull();
  expect(expandBox!.x).toBeGreaterThanOrEqual(actionsBox!.x - 1);
  expect(expandBox!.x + expandBox!.width).toBeLessThanOrEqual(actionsBox!.x + actionsBox!.width + 1);
  expect(expandBox!.y).toBeGreaterThanOrEqual(actionsBox!.y - 1);
  expect(expandBox!.y + expandBox!.height).toBeLessThanOrEqual(actionsBox!.y + actionsBox!.height + 1);
  await expect(actions.getByRole("button", { name: "Expand composer" })).toBeVisible();
  await expect(page.locator(".composer-input-wrap").getByRole("button", { name: "Expand composer" })).toHaveCount(0);
  const geometry = await expectComposerGeometry(page);
  expect(geometry.textareaBottom).toBeLessThanOrEqual(geometry.actionsTop + 1);
  await textarea.fill("Short again");
  await expect(expand).toHaveCount(0);
  await expect.poll(() => textarea.evaluate((element, baseline: number) => Math.abs(element.getBoundingClientRect().height - baseline), shortDraftHeight)).toBeLessThanOrEqual(1);
  await textarea.fill(Array.from({ length: 20 }, (_, i) => `Prompt line ${i + 1}`).join("\n"));
  await expect(expand).toBeVisible();
  await textarea.fill("");
  await expect(expand).toHaveCount(0);
});

test("Expand opens a full-screen composer layer at desktop and mobile widths", async ({ page }) => {
  for (const { width, height } of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await openSampleConversation(page, width, height);
    const textarea = page.getByRole("textbox", { name: "Message Nibie" });
    await textarea.fill(Array.from({ length: 20 }, (_, index) => `Prompt line ${index + 1}`).join("\n"));
    const expand = page.locator(".composer-actions").getByRole("button", { name: "Expand composer" });
    await expect(expand).toBeVisible();
    await expect(page.locator(".composer-input-wrap").getByRole("button", { name: "Expand composer" })).toHaveCount(0);
    await expand.click();
    const dialog = page.getByRole("dialog", { name: "Expanded message composer" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const collapse = page.getByRole("button", { name: "Collapse composer" });
    await expect(collapse).toBeVisible();
    const [dockBox, composerBox] = await Promise.all([page.locator(".composer-dock").boundingBox(), page.locator(".composer.is-expanded").boundingBox()]);
    expect(dockBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    for (const box of [dockBox!, composerBox!]) {
      expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - height)).toBeLessThanOrEqual(1);
    }
    await expect.poll(() => page.locator(".chat-header").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
    await expect.poll(() => page.locator(".workspace-sidebar").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
    const send = page.getByRole("button", { name: "Send message" });
    await send.focus();
    await page.keyboard.press("Tab");
    await expect(collapse).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(send).toBeFocused();
    await page.locator(".chat-header .header-new-chat").evaluate((element) => (element as HTMLElement).focus());
    await expect(send).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(textarea).toBeFocused();
    await expect.poll(() => page.locator(".chat-header").evaluate((element) => (element as HTMLElement).inert)).toBe(false);
    await expect.poll(() => page.locator(".workspace-sidebar").evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  }
});

test("expand and collapse preserve draft, focus, selection, and send reset", async ({ page }) => {
  await openSampleConversation(page, 390, 844);
  const textarea = page.getByRole("textbox", { name: "Message Nibie" });
  const draft = Array.from({ length: 20 }, (_, index) => `Prompt line ${index + 1}`).join("\n");
  await textarea.fill(draft);
  const expand = page.getByRole("button", { name: "Expand composer" });
  await expect(expand).toBeVisible();
  const actions = page.locator(".composer-actions");
  const [actionsBox, expandBox] = await Promise.all([actions.boundingBox(), expand.boundingBox()]);
  expect(actionsBox).not.toBeNull();
  expect(expandBox).not.toBeNull();
  expect(expandBox!.x).toBeGreaterThanOrEqual(actionsBox!.x - 1);
  expect(expandBox!.x + expandBox!.width).toBeLessThanOrEqual(actionsBox!.x + actionsBox!.width + 1);
  expect(expandBox!.y).toBeGreaterThanOrEqual(actionsBox!.y - 1);
  expect(expandBox!.y + expandBox!.height).toBeLessThanOrEqual(actionsBox!.y + actionsBox!.height + 1);
  await expect(actions.getByRole("button", { name: "Expand composer" })).toBeVisible();
  await expect(page.locator(".composer-input-wrap").getByRole("button", { name: "Expand composer" })).toHaveCount(0);
  await expand.click();
  await expect(page.getByRole("button", { name: "Collapse composer" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse composer" }).click();
  await textarea.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(12, 24); });
  const compactHeight = await textarea.evaluate((element) => Number.parseFloat(getComputedStyle(element).maxHeight));
  await page.getByRole("button", { name: "Expand composer" }).click();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue(draft);
  await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(compactHeight);
  await expect.poll(() => textarea.evaluate((element) => (element as HTMLTextAreaElement).selectionStart)).toBe(12);
  await expect.poll(() => textarea.evaluate((element) => (element as HTMLTextAreaElement).selectionEnd)).toBe(24);

  const expandedHeight = await textarea.evaluate((element) => element.getBoundingClientRect().height);
  await page.getByRole("button", { name: "Collapse composer" }).click();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue(draft);
  await expect.poll(() => textarea.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(expandedHeight);
  await page.getByRole("button", { name: "Expand composer" }).click();
  await expect(textarea).toHaveValue(draft);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(textarea).toHaveValue("");
  await expect(page.getByRole("button", { name: "Collapse composer" })).toHaveCount(0);
  await expect(page.getByText("Your message is shown in this local preview.")).toBeVisible();
});

test("Room and model menus align to their controls", async ({ page }) => {
  await openSampleConversation(page, 1440, 900);
  const controls = page.locator(".composer-secondary-tools");
  for (const { name, menuName } of [{ name: /^Room:/, menuName: "Select room" }, { name: /^Model:/, menuName: "Model" }]) {
    const button = controls.getByRole("button", { name });
    const buttonBox = await button.boundingBox();
    await button.click();
    const menu = page.getByRole("menu", { name: menuName });
    const menuBox = await menu.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    if (menuName === "Select room") expect(Math.abs(menuBox!.x - buttonBox!.x)).toBeLessThan(1);
    else expect(Math.abs(menuBox!.x + menuBox!.width - buttonBox!.x - buttonBox!.width)).toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
});

test("a long Room name does not push the composer controls off-screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/preview");
  await page.getByRole("button", { name: "Open conversation menu" }).click();
  const longRoomName = "A room with a deliberately long name for the mobile composer control";
  const sidebar = page.locator(".mobile-sidebar");
  await sidebar.getByRole("button", { name: "New room", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create a room" });
  await dialog.getByRole("textbox", { name: "Room name" }).fill(longRoomName);
  await dialog.getByRole("button", { name: "Set up manually" }).click();
  await page.getByRole("dialog", { name: "Make this room yours" }).getByRole("button", { name: "Create room" }).click();
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const textarea = page.getByRole("textbox", { name: "Message Nibie" });
  await textarea.fill("Keep the long Room name accessible in the composer.");
  await page.getByRole("button", { name: "Send message" }).click();
  const roomButton = page.locator(".composer-secondary-tools").getByRole("button", { name: `Room: ${longRoomName}` });
  await expect(roomButton).toBeVisible();
  await expect(roomButton).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});
