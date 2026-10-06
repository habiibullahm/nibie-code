import { notFound } from "next/navigation";
import { ChatWorkspace } from "@/components/chat-workspace";
import { modelPickerCopy, type ModelOption } from "@/lib/chat/models";
import { weeklyCreditCost } from "@/lib/usage/policy";
import { requestTime } from "@/lib/chat/groups";
import { loadLatestShippedReleasePreview } from "@/lib/changelog-source";

export const dynamic = "force-dynamic";

// Local mock only: the picker is shown with all three modes so the UI can be reviewed without any provider configuration.
const previewModels: ModelOption[] = (["Fast", "Balanced", "High"] as const).map((id) => ({ id, ...modelPickerCopy[id], credits: weeklyCreditCost[id] }));

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ChatWorkspace email="preview@nibie.local" preview models={previewModels} renderedAt={requestTime()} releasePreview={loadLatestShippedReleasePreview()} />;
}
