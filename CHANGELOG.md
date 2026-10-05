<!-- Newest entry first. Use a version heading only for a release that actually shipped. Each shipped entry includes the date, Added, Changed, Fixed, Removed or Deprecated when relevant, Known issues, and important user-visible behavior. -->

# Changelog

What's new in Nibie.

## Unreleased

### Added

- Expandable chat composer with a compact default for long prompts.
- Deployment identity from the Vercel git commit, exposed safely at `GET /api/health`.
- Structured server logs for chat generation, with one request id across start, context build, and completion or failure.
- Release checklist, version policy, migration inventory rules, hotfix steps, and rollback notes.
- `npm run release:check`, which fails on duplicate migration numbers, a journal that does not match `drizzle/*.sql`, missing release docs, or unresolved merge markers.
- A release stays incomplete until the changelog, release note, and current product docs match verified production. The version tag comes after that.
- Chat attachments: attach up to three text, Markdown, CSV, JSON, source-code, or text-based PDF files to a message with **+** or by dropping them on the composer. Nibie answers from their text in that conversation, including follow-ups, and the sent message shows its files. Attachments stay with their message: they are not Room files and are not shared with other threads. See [Chat Attachments V1](docs/feature/attachments/v1.md). Needs migration `0009_chat_attachments.sql`.

### Changed

- Assistant answers use adaptive formatting: plain prose for simple answers, `##`/`###` headings only when sections help, numbered steps, small tables for comparisons, and fenced code with its language. Answer text is slightly larger and calmer, headings stay compact, inline code is quieter, and tables scroll inside their frame on phones instead of breaking words.
- Chat and room-draft failure logs now use stable event names and operational codes. User-facing errors are unchanged.

### Fixed

- Stop is now decided on the server. A stopped reply keeps exactly the text that was on screen and stays marked Stopped after a reload or the next message, even if the model finished in the meantime. The server stops the generation within about a second, even when the host does not pass the browser disconnect on. A reply stopped before any text shows "Response stopped." instead of "…". Repeating Stop changes nothing, and sending right after Stop still works ([#12](https://github.com/habiibullahm/nibie-code/issues/12)).
- The integration test suite resolves the `@/` import alias again, so the row-level security tests can run.

### Known issues

- Chat attachments: images and scanned PDFs are not supported, a sent attachment cannot be downloaded, and account export does not include attachments yet.

## Current development

### Workspace

- Rooms keep a brief, instructions, and their own threads
- Pins and selected files stay with the Room you are in
- A context panel shows the profile, room, pins, selected files, and recent messages
- Workbench documents you can create, edit, and save
- Archive and restore for conversations

### Chat

- Streaming replies, with stop, retry, regenerate, and edit-and-resend
- Composer grows for multiline prompts; Expand composer opens more editing space, and Collapse returns to the compact view
- Fast, Balanced, and Reasoning, plus reasoning effort where a mode supports it

### Account

- Settings cover language, the model, and how Nibie replies
- Email sign-in, Google sign-in, and sign-out on every device
- Public landing, docs, and privacy pages
