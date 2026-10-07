<!-- Newest entry first. Every pull request that changes what users can see or do adds a line under "## Unreleased" (CI enforces this; purely internal changes use the no-changelog label). Put the most notable lines first in each group: Help → What's new previews the first four Added, Changed, and Fixed lines. Groups: Added, Changed, Fixed, Removed, Deprecated, Security, Known issues. Use a version heading (for example "## v1.0.0" followed by a date line) only for a release that actually shipped. Keep public entries concise and user-facing: visible capabilities, meaningful UX improvements, reliability fixes, and important limitations. Keep implementation and release-engineering details in the release checklist, release notes, or relevant feature and engineering docs. -->

# Changelog

What's new in Nibie.

## Unreleased

### Added

- Choose Deep Research from the Research menu for a bounded multi-source researched answer with citations, progress stages, and Incomplete/Failed labels when collection is partial or fails.
- When a reply uses web sources, Nibie shows clickable citation markers and a Sources list with title and domain, kept with the message so they survive reload.
- Ask Nibie to remember a preference or project fact across conversations, and manage or turn off Memory in Settings. Your current request always wins over what was saved.
- When a question needs current public information, Nibie can search the web and ground the reply in labelled sources while keeping Room files and your request in charge.
- Give long prompts a larger editing space while keeping short messages compact.
- Track your 500-credit weekly AI allowance and next reset in Settings; each response mode uses a different amount.
- Attach up to three text-based files—text, Markdown, CSV, JSON, source code, or text-based PDFs—to a conversation. Nibie can answer follow-up questions from their contents, and the files stay with that conversation.
- Add private Room files including DOCX and source formats; Nibie can find relevant text excerpts in the current Room when answering a question.
- Long conversations keep their thread: Nibie maintains a short summary of earlier messages in the background, so replies stay grounded in older context while recent messages are still used word for word.

### Changed

- Nibie now uses an abstract ribbon mark instead of a letter-like symbol, and the mark moves subtly while a reply is being written.
- Nibie's dark workspace now uses calmer neutral graphite surfaces and a clearer text hierarchy, so long answers, conversation titles, and section labels are easier to read during long chats.
- Weekly AI allowance is now 500 credits per week (was 100); Fast, Balanced, and High still cost 1, 3, and 6.
- In a Room, Nibie finds relevant file excerpts from both keywords and meaning, so paraphrased questions still pull the right context while exact symbols stay preferred.
- Nibie's answers are now substantive by default, with enough explanation, steps, examples, or trade-offs to understand or act without asking again, and no padding. Short follow-ups like a company name or tech stack refine your current question, and Nibie won't start a quiz or mock interview unless you ask for one. Settings → Response depth offers Concise, Default, and Detailed, and a request in your message always wins.
- Nibie answers are easier to scan, with headings, steps, comparison tables, or code when they help.

### Fixed

- Web citation markers no longer appear as raw `[SOURCE:web:…]` text when the model streams a handle across chunk boundaries; they convert to clickable `[n]` markers with the Sources list.
- Web search recognizes Indonesian web-intent and freshness cues for market questions (for example IHSG) without searching conceptual asks like “apa itu IHSG?”.
- Web search no longer fires on conceptual or coding questions that only mention weak words like version, release, price, or job.
- When web verification is unavailable, Nibie continues the reply without treating unverified current public facts as known.
- Replies now show a single thinking indicator, without repeating the response status below the message box.
- Once a conversation has started, the message box now says "Reply to Nibie…" instead of "Ask Nibie anything…".
- Help → What's new now shows the latest updates instead of saying there's no release yet.
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
