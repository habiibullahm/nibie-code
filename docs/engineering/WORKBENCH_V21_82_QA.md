# Workbench V2.1 — issue #82 verification

Recorded 12 October 2026 WIB. PR #102 now includes main `8063f48` and resolves its changelog conflict. Workbench remains behind the existing disabled product UI flag; this report does not claim hosted release acceptance.

## Behavior

Explicit Save version checkpoints persist the saved document without incrementing its revision. Autosave does not create snapshots. Duplicate checkpoints for unchanged text reuse the latest snapshot, including concurrent requests.

`commit_workbench_version` uses the requesting user's Supabase session and a document row lock. Revision validation, recovery snapshots, restore/AI Apply, and retention run in one transaction. Stale requests fail with a conflict; any snapshot or document-write failure rolls back the operation. AI Apply records both the pre-edit recovery text and the actual applied result, with the latter labeled AI-applied. It validates the stored completed run and proposal instead of trusting client-supplied text.

Database triggers serialize direct version inserts/updates and retain at most 50 snapshots per document. Document text remains limited to 100,000 characters and titles to 120. Run provenance must belong to the same owner and document. Deleting a run clears its snapshot link; deleting the document cascades its versions.

History is a native modal with keyboard focus cycling, Escape/Close, retriable loading errors, preview, and confirmation before restore. Pending restore disables dismissal and selection. Opening history or downloading first waits for pending autosave, and failed saves prevent export/restore of stale text. The editor stays locked during history/restore and export preparation.

Markdown export retains document Markdown; text export uses Copy Response V2's readable plain text conversion. Both preserve UTF-8 and use safe Unicode filenames with an ASCII fallback. Formatted copy uses neutral sanitized clipboard HTML. Export/copy strip hidden model reasoning; authenticated downloads use no-store and nosniff headers.

## Verification

- Root unit suite: 1,374 passed across 115 files. Lint: zero errors, three existing warnings. Typecheck and production build passed. Clean-tree release check is recorded on the committed PR head.
- Database integration suite: 59 passed against a disposable local PostgreSQL instance. Actual SQL tests cover owner isolation, concurrent checkpoint deduplication, competing restores with one CAS winner, recoverable overwritten text, 50-version retention under direct/concurrent writes, proposal tampering, AI snapshot semantics, rollback after a constraint failure, provenance unlinking, and document cascade deletion.
- Targeted browser suite: 15 passed across Workbench history, Workbench V2, and existing Copy Response V2 tests. Desktop 1440px and mobile 390px cover keyboard modal navigation, cancellation/confirmation, restore failure, pending-autosave downloads, Unicode filename handling, safe formatted copy, and loading retries.
- Browser server-action/export responses are fixtures. They verify UI behavior; they do not replace actual SQL tests or authenticated hosted acceptance.
- First browser attempt used 127.0.0.1, which Next.js blocked as a development origin and prevented hydration. Switching the test base URL to localhost restored interactive behavior without changing product origin configuration.
- Initial subprocess release-check failures were sandbox EPERM errors. Rerunning with the required execution permissions passed. A repeated integration run encountered a pre-existing teardown omission for a historical SQL helper; recreating only the disposable test database's public schema allowed a clean migration and successful run. No hosted database was reset.

## Migration and release

Migration 0028 is still unmerged and has not been applied to a hosted database by this work. It adds the versions table, owner RLS, triggers, and the atomic RPC. The app fails closed if that RPC is absent; deploy the migration before enabling Workbench.

The Preview additive checker recognizes only the exact reviewed runtime retention function on the new versions table. That function is installed at migration time and deletes old snapshots only when versions are later written. Changing its scope, retention bound, target table, or adding top-level DELETE statements still fails the checker. The separate shared-database approval gate is unchanged.

Hosted acceptance remains pending:

1. Apply reviewed migration 0028 through the repository's database workflow and verify the PostgREST RPC/schema cache.
2. On the exact Preview SHA, use two signed-in owners to exercise save/checkpoint, preview, restore, both downloads, formatted copy, cross-owner rejection, Room deletion, reload, mobile/keyboard, and concurrent writes. AI Apply can use a stored controlled proposal for transaction verification; any paid live generation requires its own approved evaluation budget.
3. Verify real Word/Google Docs paste behavior and obtain product release readiness before enabling the Workbench flag.

Issue #82 must remain open until its exact-SHA hosted acceptance criterion is satisfied. Preview Supabase isolation remains excluded as previously requested.
