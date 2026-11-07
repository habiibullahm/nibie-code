import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat-workspace";
import { DemoBanner } from "@/components/demo-banner";
import { modelPickerCopy, type ModelOption } from "@/lib/chat/models";
import { requestTime } from "@/lib/chat/groups";
import { weeklyCreditCost } from "@/lib/usage/policy";

export const dynamic = "force-dynamic";

const demoModels: ModelOption[] = (["Fast", "Balanced", "High"] as const).map((id) => ({
  id,
  ...modelPickerCopy[id],
  credits: weeklyCreditCost[id],
}));

export const metadata: Metadata = {
  title: "Demo",
  description: "A public recorded walkthrough of Nibie chat and cited research. No account and no live model calls.",
};

export default function DemoPage() {
  return (
    <div className="demo-page" data-testid="demo-workspace">
      <DemoBanner />
      <div className="demo-workspace">
        <ChatWorkspace email="demo@nibie.local" preview demo models={demoModels} renderedAt={requestTime()} />
      </div>
    </div>
  );
}
