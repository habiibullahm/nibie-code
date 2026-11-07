import { z } from "zod";

const modelId = z.string().trim().regex(/^[A-Za-z0-9._:/-]{1,128}$/);

export const agentWriteSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500).nullable().optional(),
  avatar: z.enum(["spark", "code", "search", "write", "book"]),
  systemInstructions: z.string().trim().min(1).max(8000).nullable().optional(),
  providerBinding: z.enum(["system", "explicit", "default_provider"]),
  providerConfigId: z.string().uuid().nullable().optional(),
  systemMode: z.enum(["Fast", "Balanced", "High"]).nullable().optional(),
  model: modelId.nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).nullable().optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.providerBinding === "system") {
    if (!value.systemMode || value.model || value.providerConfigId || value.temperature != null || value.maxOutputTokens != null) {
      ctx.addIssue({ code: "custom", message: "A system agent uses only a Fast, Balanced, or High mode." });
    }
  } else if (!value.model) {
    ctx.addIssue({ code: "custom", path: ["model"], message: "Enter a model id." });
  }
  if (value.providerBinding === "explicit" && !value.providerConfigId) {
    ctx.addIssue({ code: "custom", path: ["providerConfigId"], message: "Choose a provider." });
  }
  if (value.providerBinding !== "explicit" && value.providerConfigId) {
    ctx.addIssue({ code: "custom", message: "Only an explicit provider binding stores a provider." });
  }
});

export function parseAgentWrite(input: unknown) {
  return agentWriteSchema.safeParse(input);
}

export type AgentWrite = z.infer<typeof agentWriteSchema>;
