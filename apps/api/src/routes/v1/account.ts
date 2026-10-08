import { EXPORT_FILENAME, parseDeleteConversationsRequest, parseSignOutRequest, signOutResponseSchema } from "@nibie/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deleteAllConversations, exportAccount } from "../../account/repository.js";
import { ApiError } from "../../plugins/error-handler.js";
import { signOutGlobalSession } from "../../plugins/supabase.js";

const ownerKeys = ["user_id", "userId", "user"] as const;
const mutationBodyLimit = 1024;

function rejectOwnerQuery(query: unknown, message: string) {
  if (!query || typeof query !== "object" || Array.isArray(query)) return;
  for (const key of ownerKeys) {
    if (key in query) throw new ApiError(400, "validation_error", message);
  }
}

function requireUser(request: FastifyRequest) {
  if (!request.supabase || !request.auth?.userId) {
    throw new ApiError(401, "unauthorized", "Authentication required.");
  }
  return { supabase: request.supabase, userId: request.auth.userId };
}

function exportHeaders(reply: FastifyReply) {
  reply.header("content-type", "application/json; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="${EXPORT_FILENAME}"`);
  reply.header("cache-control", "no-store");
  reply.header("x-content-type-options", "nosniff");
}

export function registerAccountRoutes(app: FastifyInstance) {
  app.get("/v1/account/export", async (request, reply) => {
    rejectOwnerQuery(request.query, "Export is limited to your account.");
    const { supabase, userId } = requireUser(request);
    const payload = await exportAccount(supabase, userId);
    exportHeaders(reply);
    return payload;
  });

  app.post("/v1/account/conversations/delete-all", { bodyLimit: mutationBodyLimit }, async (request, reply) => {
    rejectOwnerQuery(request.query, "Invalid request.");
    const parsed = parseDeleteConversationsRequest(request.body);
    if ("error" in parsed) throw new ApiError(400, "validation_error", parsed.error);
    const { supabase, userId } = requireUser(request);
    reply.header("cache-control", "no-store");
    return deleteAllConversations(supabase, userId);
  });

  app.post("/v1/auth/sign-out", { bodyLimit: mutationBodyLimit }, async (request, reply) => {
    rejectOwnerQuery(request.query, "Invalid request.");
    const parsed = parseSignOutRequest(request.body);
    if ("error" in parsed) throw new ApiError(400, "validation_error", parsed.error);
    const { supabase } = requireUser(request);
    await signOutGlobalSession(supabase);
    reply.header("cache-control", "no-store");
    return signOutResponseSchema.parse({ scope: parsed.scope });
  });
}
