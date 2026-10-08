import type { ProviderMessage } from "@/lib/ai/provider";
import { sanitizeModelOutput } from "@/lib/ai/sanitize-model-output";
import { CONTEXT_DATA_PREAMBLE } from "@/lib/context/context-policy";
import type { ContextPlan } from "@/lib/context/context-types";

export function toProviderMessages(plan: ContextPlan): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  const core = plan.blocks.find((block) => block.id === "core" && block.included);
  if (core) messages.push({ role: "system", content: core.text });
  const chatRole = plan.blocks.find((block) => block.id === "chat_role" && block.included);
  const profile = plan.blocks.find((block) => block.id === "profile" && block.included);
  const room = plan.blocks.find((block) => block.id === "room" && block.included);
  const pins = plan.blocks.find((block) => block.id === "pins" && block.included);
  const file = plan.blocks.find((block) => block.id === "file" && block.included);
  const attachment = plan.blocks.find((block) => block.id === "attachment" && block.included);
  const web = plan.blocks.find((block) => block.id === "web" && block.included);
  const memory = plan.blocks.find((block) => block.id === "memory" && block.included);
  const summary = plan.blocks.find((block) => block.id === "thread_summary" && block.included);
  if (chatRole || profile || room || pins || file || attachment || web || memory || summary) {
    messages.push({ role: "system", content: [CONTEXT_DATA_PREAMBLE, chatRole?.text, profile?.text, room?.text, pins?.text, file?.text, attachment?.text, web?.text, memory?.text, summary?.text].filter(Boolean).join("\n\n") });
  }
  for (const block of plan.blocks) {
    if (!block.included || !block.dialogueRole) continue;
    if (block.id !== "recent_messages" && block.id !== "current_request") continue;
    const content = block.dialogueRole === "assistant" ? sanitizeModelOutput(block.text).text : block.text;
    messages.push({ role: block.dialogueRole, content });
  }
  return messages;
}
