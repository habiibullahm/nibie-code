import { expect, type Page } from "@playwright/test";
import { validateConversationId } from "../../lib/chat/validation";

export function conversationIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = validateConversationId(new URL(url).searchParams.get("conversation"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Archive only the conversation captured from that test's URL to keep the dedicated E2E account's active history clean.
export async function removeConversation(page: Page, url: string | undefined) {
  const id = conversationIdFromUrl(url);
  if (!id) return;
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.goto(`/chat?conversation=${encodeURIComponent(id)}`);
  await expect(page).toHaveURL((url) => url.pathname === "/chat" && url.searchParams.get("conversation") === id);
  const row = page.locator(".desktop-sidebar").locator(`[data-conversation-id="${id}"]`);
  const archive = row.getByRole("button", { name: /^Archive / });
  if (await archive.count() !== 1) return;
  await archive.click();
  await expect(row).toHaveCount(0);
}
