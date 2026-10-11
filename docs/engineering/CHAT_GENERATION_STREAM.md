# Shared provider-stream runner

Ordinary chat and automatic Web/GitHub Actions prepare their provider response,
then call `lib/chat/orchestration/stream-response.ts`. The runner consumes SSE,
filters reasoning and citation markers, measures visible first-token timing,
retains provider usage/finish metadata, saves the terminal result, and emits
existing delta/status/error events. Concurrent `run()` calls share one reader.

The route owns authentication, generation claim, context preparation and usage
gates. The Action path also owns tool execution and its start/source events.
Both callers retain provider creation, cost estimation, spend settlement,
telemetry, cleanup and final done/close framing. Deep Research keeps its separate
orchestration. No schema, model, pricing, reservation or tool policy changes.

The persistence helper remains the conditional database writer. A Stop-owned
row cannot be overwritten; completion is announced only after a successful
complete save. Summary maintenance runs only after that save. An observed Stop
attaches citations to the kept reply without another content write. Failure and
interruption keep partial text after sealing both filters.

The extraction preserves existing path differences explicitly: ordinary chat
reports a provider timeout as an error; Actions classify an aborted synthesis as
interrupted. Ordinary chat's additional failure/reasoning logging stays intact.
Changing either policy requires a separate behavior change.

## Verification

Twelve runner cases cover both profiles: split reasoning/citation markers,
concurrent consumption, provider usage, Stop winning a guarded save, failed
persistence, partial provider failure, an already-observed Stop, and timeout
classification. Existing route/Stop/Action tests exercise adoption.

Local verification: 1,341 unit tests in 113 files, typecheck, full lint (zero
errors, three existing warnings), and production build passed. These mocked
provider checks do not establish real-model quality or signed-in acceptance.
