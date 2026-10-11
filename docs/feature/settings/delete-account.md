# Delete account

Status: design only. Do not implement until this lifecycle is explicitly approved.

Nibie can already sign a person out of every device and delete that person's conversations. Neither action removes the account. Account deletion is a separate, irreversible operation and the app does not have a safe server path for it yet.

## Current boundaries

- The browser talks to Supabase with the public key and the user's session. `lib/config/supabase.ts` rejects a service-role key in that path.
- Row-level security is forced. `public.users` is readable by its owner and is not granted `DELETE`.
- `public.users.id` references `auth.users.id` with `ON DELETE CASCADE`.
- `conversations.user_id` and `messages.user_id` reference `public.users` with `ON DELETE CASCADE`.
- Messages also cascade when their conversation row is deleted. That is the mechanism delete-all uses today.
- `user_preferences` stores account settings and references `public.users` with `ON DELETE CASCADE`. Its actions derive the owner from the session and reject client-supplied owner identifiers.
- `supabase.auth.signOut({ scope: "global" })` revokes sessions. It does not delete `auth.users`.

Deleting `auth.users` is an Auth admin operation. The signed-in user's JWT cannot do it, and the running app must not gain the service role in order to offer a button.

## Approved lifecycle

1. Re-authenticate. Require a fresh password sign-in (or equivalent Supabase reauthentication) immediately before the delete. A long-lived access token is not enough.
2. Confirm. Require an explicit phrase such as `DELETE ACCOUNT`, separate from the conversation delete phrase `DELETE`.
3. Resolve identity only from that fresh session. Reject any request that includes `user_id`, `userId`, or another account identifier.
4. Delete the Auth user with the service role, in a server-only environment that is not the Next.js request runtime today. A dedicated admin function, Edge Function, or other boundary that holds the service role is required. The browser and the public-key server client never see that credential.
5. Let the existing foreign keys finish the cleanup after `auth.users` is removed:
   - `public.users`
   - `user_preferences`
   - `conversations`
   - `messages`
6. Revoke every session as part of the Auth deletion, then send the browser to the signed-out login screen and clear `nibie-last-conversation`.

No step may accept an arbitrary user id from the client. If the session and the admin call disagree, abort.

## Failure and partial deletion

Treat the Auth deletion as the single commit point.

- If re-authentication, confirmation, or the admin call fails, delete nothing and show a generic error. Leave conversations, preferences, and the Auth user in place.
- If the admin call succeeds, the database cascades are the cleanup. Do not issue a second client delete that can fail halfway and report success.
- If the admin call succeeds and a cascade fails, the account may already be gone while some rows remain. That is an operator incident: the service-role job must retry deletion of `public.users` for that id (cascades run again) and must not ask the browser to finish the job.
- The user-facing response is success only after the Auth user is gone. Never report success when the admin call returns an error.
- Do not delete conversations first and the Auth user second. A failure in the middle would strand a person with an account and no chats, or with chats and no way to sign in.

## Out of scope until approval

- A Delete account button that calls Auth admin APIs
- Shipping a service-role key to the Next.js server runtime
- Deleting `auth.users` from the browser
- Reusing delete-all conversations as a substitute for account deletion
