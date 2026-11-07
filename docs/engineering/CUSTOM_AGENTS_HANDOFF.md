# Custom agents handoff

Server slice on top of `origin/feat/custom-agents` (draft PR 145). Settings screens and the chat agent picker are not in this branch.

## Landed

- Owner-scoped provider configs, including Nibie Router at `https://router.nibie.app/v1`. API keys and extra headers are encrypted with `PROVIDER_SECRET_KEY`. Responses return a key hint, not the key or ciphertext.
- Model list and a one-token connection test. A saved config is read from `read_own_provider_secret`; a typed key is used only when no config id is sent.
- Agent create, update, duplicate, delete, enable, and default. Caps stay 10 providers and 20 agents.
- New chats copy the agent onto the conversation. Later agent edits do not rewrite that copy. Built-in chats still use Fast, Balanced, and High. A snapshotted chat rejects mode changes.
- Agent instructions are quoted as untrusted context. They are not added to the product-policy block.
- Sends use the snapshot. User-provider chats call the saved base URL through the existing Chat Completions stream, reserve Balanced credits, and do not fall back to a system mode when the key or config is missing. Auth, balance, and rate-limit failures keep the safe provider messages.

`startConversationAction` takes the agent id as the seventh argument. The sixth argument is still the temporary-chat flag. Temporary chats cannot take an agent. Deep Research on a snapshotted chat is rejected and stays on built-in modes.

## Not landed

Tasks 10–12 in `docs/superpowers/plans/2026-11-07-multi-custom-agents.md`: Providers settings, Agents settings, and the composer agent menu. `lib/agents/composer-label.ts` is not written. No browser pass was run, because this slice has no new screen.

## Checks

Local unit tests, typecheck, lint, and `git diff --check` were run on this branch. Integration tests were not run here: Docker is not available. The integration config now runs files one at a time so `agents-rls` does not drop tables while `rls.test.ts` resets the same database. That deadlock failed draft PR 145.

`PROVIDER_SECRET_KEY` must be 32 bytes of base64 before a provider can be saved. Do not add the `allow-shared-db-migrate` label. That workflow applies Drizzle SQL to the shared app database, which is the production database today.
