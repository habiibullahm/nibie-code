<!-- Newest entry first. Use a version heading only for a release that actually shipped. Keep public entries concise and user-facing: visible capabilities, meaningful UX improvements, reliability fixes, and important limitations. Keep implementation and release-engineering details in the release checklist, release notes, or relevant feature and engineering docs. -->

# Changelog

What's new in Nibie.

## Unreleased

### Added

- Give long prompts a larger editing space while keeping short messages compact.
- Track your 100-credit weekly AI allowance and next reset in Settings; each response mode uses a different amount.
- Attach up to three text-based files—text, Markdown, CSV, JSON, source code, or text-based PDFs—to a conversation. Nibie can answer follow-up questions from their contents, and the files stay with that conversation.

### Changed

- Nibie answers are easier to scan, with headings, steps, comparison tables, or code when they help.

### Fixed

- Stopping a reply now preserves the text already shown, stays marked Stopped after reload, and doesn't block your next message.

### Known issues

- Attachments can't yet include images or scanned PDFs. Sent files can't be downloaded, and account exports don't include them yet.

## Current development

### Workspace

- Organize conversations in Rooms with their own instructions and threads.
- Pin important details and choose Room files to give a conversation relevant context.
- See your profile, Room details, pins, selected files, and recent messages together in the context panel.
- Create, edit, and save documents in Workbench.
- Archive conversations and restore them later.

### Chat

- Stop a reply while it's being written, retry or regenerate it, or edit and resend your latest message.
- Write in a compact message box or switch to a larger editing space for long prompts.
- Choose Fast, Balanced, or High response modes, with reasoning controls where available.

### Account

- Set your language, preferred model, and reply style in Settings.
- Sign in with email or Google, and sign out on all devices.
- Find Nibie's product guidance and privacy information.
