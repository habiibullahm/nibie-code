# Workbench V1

**Status:** Implemented on `feat/workbench-v1`  
**Product:** Nibie  
**Surface:** Persistent editable documents

Workbench is where a useful answer becomes something you can edit, save, and reopen. Chat stays the place to think. Workbench is the place the result lives afterward.

```text
Chat → useful answer → Continue in Workbench → edit → save → return later
```

V1 is one owner-scoped text document. It is not Notion, Google Docs, or a canvas.

## What V1 includes

- Create a document, title it, and edit markdown or plain text in a textarea
- Autosave after a short pause, with Saved, Saving…, and Save failed
- Reopen the document later
- Delete the document
- Optionally associate it with a Room
- Continue a finished assistant response into a new document

A document can exist with no Room. From a Room thread, Continue in Workbench stores that Room. From General, `room_id` stays null. The Room is never required.

Deleting a Room sets `room_id` to null and keeps the document. The foreign key is `ON DELETE SET NULL (room_id)`, so the owner column is not cleared. That matches conversations.

## Data

`workbench_documents`

| Column | Notes |
| --- | --- |
| `id` | Primary key |
| `user_id` | Owner. Set from the verified session, never from the client |
| `room_id` | Nullable. Same-owner link to `rooms` |
| `title` | 1–120 characters |
| `content` | Text, up to 100,000 characters. Empty is allowed |
| `created_at`, `updated_at` | `updated_at` moves on each successful write |

Row Level Security is enabled and forced. Select, insert, update, and delete policies allow only `user_id = auth.uid()`. A document cannot be attached to another user's Room: the composite foreign key is `(room_id, user_id) → rooms (id, user_id)`.

Ordinary requests use the signed-in Supabase client. They do not use the service role. Document text is not written to logs.

Saved is shown only after the write succeeds. A failed save leaves the text on screen and shows Save failed.

## Routes

- `/workbench` lists the owner's documents
- `/workbench/[id]` is the editor
- The chat sidebar links to Workbench
- A finished assistant message can offer Continue in Workbench

That action is hidden for user messages, streaming or stopped replies, and error placeholders. Creating the document does not call a model. The title is the first non-empty line, clipped to the title limit, or `Untitled`.

Workbench documents are not added to chat prompts. Context Engine behavior is unchanged.

## Non-goals

V1 does not include:

- Live collaboration
- A block editor, TipTap, or ProseMirror
- Version history
- PDF or DOCX export
- A rich formatting toolbar
- Inline AI rewrite or agent editing
- A multi-pane IDE or code execution
- File embedding
- Automatic context injection
- Comments
- Sharing or public links

Later versions can add Workbench-to-chat. This version is creation and persistence.
