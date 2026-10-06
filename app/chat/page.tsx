import { requireAuthenticatedUser } from "@/lib/auth/require-user";
import { ChatWorkspace } from "@/components/chat-workspace";
import { getChatWorkspaceData } from "@/lib/chat/read";
import { getModelOptions } from "@/lib/ai/registry";
import { readOwnerPreferences } from "@/lib/preferences/store";
import { requestTime } from "@/lib/chat/groups";
import { loadWhatsNewPreview } from "@/lib/changelog-source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const params = await searchParams;
  // Verifying the session and loading the owner's data are independent round trips, so they run together.
  // Preferences are one owner row read in parallel; a failure falls back to defaults and does not block the workspace.
  const [user, data, preferenceState] = await Promise.all([
    requireAuthenticatedUser(),
    getChatWorkspaceData(params.conversation),
    readOwnerPreferences(),
  ]);
  // Only configured modes are offered; this reads environment variable names, never the provider URL or key.
  const { models } = getModelOptions();
  const releasePreview = loadWhatsNewPreview();
  return <ChatWorkspace email={user.email ?? "Your account"} metadataName={user.name} initialData={data} models={models} renderedAt={requestTime()} preferences={preferenceState.preferences} preferencesError={preferenceState.error} releasePreview={releasePreview} />;
}
