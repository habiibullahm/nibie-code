# Custom agents handoff

Branch `feat/custom-agents-routing-53cd` (PR 147). It replaces closed PR 146, which used a `feature/` name that PR Guard rejects. The commits through `68cc3b0` are the same. Draft PR 145 stays open. `scripts/dev-local.mjs` was not modified.

## Landed

- Owner-scoped provider configs, including Nibie Router at `https://router.nibie.app/v1`. API keys and extra headers are encrypted with `PROVIDER_SECRET_KEY`. Responses return a key hint, not the key or ciphertext.
- Model list and a one-token connection test.
- Agent create, update, duplicate, delete, enable, and default. Caps stay 10 providers and 20 agents.
- New chats copy the agent onto the conversation. Later agent edits do not rewrite that copy. Built-in chats still use Fast, Balanced, and High. A snapshotted chat rejects mode changes.
- Agent instructions are quoted as untrusted context.
- Sends use the snapshot. A missing key or config fails closed and does not fall back to a system mode. User-provider chats reserve Balanced credits.
- Settings has Providers and Agents, after AI & Models. Preview shows “No providers yet.” and “New agent” without calling a provider.
- A signed-in new chat has an Agent menu. Nibie keeps Fast, Balanced, and High. Choosing an agent sends that id. After the chat exists, a snapshot replaces the Model menu with the saved agent name.

`startConversationAction` takes the agent id as the seventh argument. The sixth argument is still the temporary-chat flag. Temporary chats cannot take an agent. Deep Research on a snapshotted chat is rejected.

## Checks

Unit tests, typecheck, lint, production build, and `git diff --check` were run on this work. Settings e2e on `/preview` passed, including the new tabs at 320, 390, 768, 1024, and 1440. Composer layout e2e on `/preview` passed. The signed-in model-picker e2e skipped because `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` are not set, so the Agent menu was not clicked in a signed-in browser. Integration tests were not run: Docker is not available. Integration files run one at a time so the RLS file does not deadlock the shared reset.

## Not applied

`PROVIDER_SECRET_KEY` must be 32 bytes of base64 before a provider can be saved. Do not add `allow-shared-db-migrate`. That workflow writes to the shared production database. Migration `drizzle/0030_custom_agents.sql` is included from PR 145 and has not been applied to production from this work.
