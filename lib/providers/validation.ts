import { z } from "zod";
import { assertProviderBaseUrl } from "@/lib/ai/provider-url";

const blockedHeaders = new Set(["authorization", "host", "cookie", "content-length", "proxy-authorization"]);
const headerName = z.string().regex(/^[A-Za-z0-9-]{1,40}$/).refine((name) => !blockedHeaders.has(name.toLowerCase()));
const headerSchema = z.object({ name: headerName, value: z.string().trim().min(1).max(200) });

export const providerWriteSchema = z.object({
  id: z.string().uuid().optional(),
  providerType: z.enum(["nibie_router", "openai_compatible"]),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(8).max(300),
  apiKey: z.string().trim().min(1).max(400).optional(),
  headers: z.array(headerSchema).max(5).optional(),
  isDefault: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.id && !value.apiKey) ctx.addIssue({ code: "custom", path: ["apiKey"], message: "Enter an API key." });
  try { assertProviderBaseUrl(value.providerType, value.baseUrl); } catch (error) {
    ctx.addIssue({ code: "custom", path: ["baseUrl"], message: error instanceof Error ? error.message : "Base URL is invalid." });
  }
});

export function parseProviderWrite(input: unknown) {
  return providerWriteSchema.safeParse(input);
}

export type ProviderWrite = z.infer<typeof providerWriteSchema>;
