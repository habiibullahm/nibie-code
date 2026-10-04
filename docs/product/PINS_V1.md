# Pins V1

A pin is a small piece of durable context the user chooses to keep. It is not automatic memory, and Nibie does not create pins from a reply.

## Ownership

A pin belongs to one signed-in user and one room. `user_id` is taken from the verified session (`auth.uid()`), never from the client body. The room must belong to that same user. The database enforces this with a foreign key on `(room_id, user_id)` → `rooms(id, user_id)`.

Row-level security is enabled and forced. Select, insert, update, and delete are allowed only when `user_id = auth.uid()`. Ordinary runtime does not use `service_role`.

## Room relationship

`room_id` is required. V1 has no workspace-wide pins.

Deleting a room deletes its pins (`ON DELETE CASCADE`). Threads in that room stay and become general threads, so they stop receiving those pins. Moving a thread to General also stops room pins from being included, because a general thread has no `room_id`.

## What the user can do

Inside a room: view pins, add a pin, edit it, or delete it. Each pin has a title (up to 80 characters) and content (up to 1,000 characters).

## Context ordering

For a thread inside a room, the prompt is assembled in this order:

1. System / core product rules
2. Profile
3. Room instructions and room brief
4. Room pins
5. Thread summary
6. Recent messages
7. Current request

The current request is reserved before any soft context and stays the last user message. Profile, room instructions, the brief, pins, the summary, and messages are untrusted data. Pin text is quoted user data. It is never copied into the core system rules.

A general thread, or any thread with `room_id` null, does not receive room pins.

## Token budget

Pins share one cap of 800 estimated tokens (`ceil(characters / 4)`), and they also lose to whatever input budget remains after the core rules, the current request, the protected recent messages, the profile, and the room instructions and brief.

Pins are ordered by `updated_at` descending, then `id` ascending. A pin is included whole or not at all. A pin that does not fit is skipped, and a later smaller pin may still fit. The context panel says **Pinned context** with the reason **This room** only when pin text was actually included. It does not show pin text, token counts, or provider internals.

## Non-goals

Pins V1 does not add automatic memory, Recall, embeddings, semantic retrieval, a vector database, RAG, web clipping, auto-pin from an assistant message, tags, folders, collaborative pins, files, workbench, or actions.
