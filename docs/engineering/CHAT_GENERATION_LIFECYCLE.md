# Shared generation cancellation and usage coordination

Ordinary chat and automatic Web/GitHub Actions use the server-only
`lib/chat/orchestration/generation-lifecycle.ts`. It owns their upstream abort
signal, request-disconnect flag, database Stop watch, provider timeout, and
usage start/release/settlement attempts.

## Cancellation and cleanup

Ordinary chat starts polling after reservation; Actions start before tool
execution, matching their existing order. Only one Stop read can be outstanding.
Read errors retry on a later tick. A successful read of a non-streaming or missing
reply aborts upstream; this retains the existing terminal-row handling. A read
that finishes after cleanup cannot change the generation's state.

The synthesis timeout remains 120 seconds and starts just before the provider
request. Action execution retains its separate 45-second runtime timeout. Request
abort, explicit Stop, consumer cancellation, and provider timeout keep distinct
flags, so the callers retain their existing SSE/error decisions. Deep Research
retains its specialized orchestration.

`cleanup()` is idempotent: it removes the request listener, clears both timers,
and aborts upstream. Consumer cancellation calls it immediately. Ordinary chat
also calls it on usage-start failure, fixing the previously surviving Stop
interval. Its stream finalizer guarantees cleanup even when settlement or
telemetry fails.

## Usage coordination

Reservation gates and their existing policy remain in the callers. In particular,
an Action's preflight hold is never released and re-reserved. Mode weights, spend
ceilings, provider configuration, and provider-establishment failure decisions
are unchanged.

`startUsage()` coalesces concurrent start calls. `releaseBeforeStart()` coalesces
release calls, waits for any pending start result, and never refunds a successful
start. `settleSpend()` requires a successful start and shares one finalization
attempt, with the first actual-cost estimate. A failed settlement is reported by
the existing spend adapter and never converted into a post-start refund.

These promises coordinate one generation in one process. Database conditional
message writes, owner checks, usage row locks, and idempotent RPCs remain the
cross-instance authority. The helper does not replace them or automatically
release reservations on generic cancellation.

## Regression evidence

Three focused route cases fail on baseline main `85d196b`: usage-start rejection
leaves one Stop timer, and the post-start Action error handler attempts a release
after both successful and failed spend settlement. The same cases pass with the
coordinator. Helper tests cover overlapping start/release/settlement calls,
request/consumer cancellation, timer disposal, failed Stop reads, and cleanup
during an outstanding read. Existing route and server-authoritative Stop tests
exercise adoption through ordinary and Action responses.

Shared prompt preparation, stream filtering, persistence terminal decisions,
SSE framing, and telemetry formatting remain in the callers for the subsequent
stream-runner extraction. Live provider quality acceptance remains a separate
release gate.
