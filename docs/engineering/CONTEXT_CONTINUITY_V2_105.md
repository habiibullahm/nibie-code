# Context Continuity V2 — bounded offline candidate

Starting point: `8dc35a44c03d3b4945eda4cb0e529cb0f74d879c` on October 12,
2026. Issue #105 remains partial; real-answer quality is gated by Issue #80's
authorized provider captures and independent human review.

## Demonstrated gap and change

The existing builder reported allocation omissions to the UI and logs, but its
provider request did not say that earlier turns had been left out. A 41-message
fixture retained 32 turns due to the history limit, while its core policy
still told the model to keep earlier facts active without an omission notice.
This is a deterministic request-construction gap, not an observed hallucination
or a live answer-quality score.

When supplied history or caller-observed rows are omitted by the count cap or
allocation budget, core policy now explicitly says: “Some thread history is omitted. Never invent
missing earlier facts or decisions.” The builder performs one additional bounded
allocation with that instruction included in the core token estimate. It never
appends an unbudgeted message after allocation. Complete supplied history keeps
the original core unchanged. Large files or optional profile text alone do not
trigger a misleading thread-history notice.

The instruction costs about 20 character/4 estimated tokens plus separation,
inside the same 16,384-token envelope and 2,048-token planning reserve. A tight
budget can therefore retain fewer optional sources or earlier turns. No mode,
output ceiling, fetch cap, model, reasoning effort, billing policy, tokenizer,
or automatic retrieval is changed. A current request that leaves insufficient
space for mandatory core/omission guidance follows the existing context-build
failure path; no text is silently cut to make it fit.

## Route omission metadata follow-up

The chat handler already reads at most 34 complete rows, then caps eligible
history at 32 before invoking the builder. Builder-only fixtures with 41 supplied
messages did not exercise that production boundary. Handler regressions reproduced
the missing notice in Fast/Balanced/High with 34 fetched rows and 32 retained turns.

The route now passes only the positions of eligible rows discarded by that cap
as internal `omittedMessagePositions`. Ordinary chat, automatic Web/GitHub, and
Deep Research all forward this evidence. No extra database read, fetch-window
increase, private body transfer, or inference from numeric position gaps is added.
The builder deduplicates valid discarded positions and excludes retained/future
positions. A fitted summary covers an observed omission only when its coverage
reaches that position; an uncovered discarded correction invalidates the summary.
Counts include observed rows only, not an exact total of unfetched history.

Context details distinguish history-limit omissions from allocation omissions;
both now set the existing `truncated` metadata flag.
Rejected summaries that cover the current reply/newer turns have a specific
reason. The internal `plan.continuity` object contains only counts and an enum
for summary inclusion/staleness/budget/absence. It does not change the persisted
browser/SSE schema or log private message text. `context.built` logging now records
`countCapOmissions`, `budgetOmissions`, and `summaryState` alongside the existing
truncation and token estimates in all three synthesis paths. Discarded positions
and context bodies are not logged or persisted.

## Offline fixture checks

- Short complete conversation and covered-summary history keep normal provider
  input and current-request ordering.
- Long, unsummarized history gets the notice across Fast/Balanced/High and stays
  within the current estimated budget.
- A summary with a known uncovered gap is rejected. Recent English/Indonesian
  corrections and a terse follow-up remain in the provider dialogue.
- Rebuilding from serialized/reloaded identical inputs gives identical provider
  messages; this does not prove signed-in database refresh behavior.
- Oversized turns produce allocation omissions, distinct from count omissions.
  Counts and diagnostic reasons contain no private text.
- Existing Room, Pins, selected files, Memory, Web, interruption/summary
  lifecycle and continuous-newest-suffix tests remain applicable. Sources stay
  untrusted; current-request/correction authority is preserved.
- Real handler fixtures cover route-cap notices, covered and uncovered summaries,
  retained bilingual corrections/follow-ups, simultaneous count/token omissions,
  and forwarding through ordinary, Web, public GitHub, and Deep Research synthesis.
  External transports, provider output, and persistence are mocked; no live-answer
  accuracy or authenticated database refresh is established.

Run the focused suite with Node 22:

```sh
npx vitest run tests/unit/context-engine.test.ts \
  tests/unit/chat-context-continuity.test.ts \
  tests/unit/context-allocation-evaluation.test.ts \
  tests/unit/response-quality.test.ts tests/unit/thread-summary-lifecycle.test.ts \
  tests/unit/thread-summary-store.test.ts tests/unit/recall-context.test.ts \
  tests/unit/web-context.test.ts tests/unit/chat-route.test.ts \
  tests/unit/deep-research-chat-stream.test.ts --maxWorkers=1
```

In the sprint cloud environment, run commands through the coordinator's
credential-masking offline launcher after sourcing Node activation. This
original builder-only candidate passed 332 focused tests in eight files. The
route follow-up passed 166 focused tests in four files, including the new handler
regressions. Current broad/browser/build results belong in the PR at the exact
candidate SHA; these counts do not imply live acceptance.

## Honest limits and release gates

Only omitted supplied messages and caller-observed discarded positions can be
counted. The builder cannot discover messages outside the caller's database read window, an unsupplied interrupted
reply, edits to summary-covered history, or the factual accuracy of a model-made
summary. A zero omission count means the supplied context is represented, not
that every old fact or source was fetched or remembered. The existing 34-row read
can be exhausted, and filtering later turns or interrupted replies can leave
history outside that window unknown. Those limits are not inferred from positions
or disguised as an exact message count. No cross-thread reads
are added; saved Memory stays distinct from historical messages.

Human-reviewed bilingual real outputs, effective provider capability/pricing,
bounded-spend authorization, signed-in exact-SHA Preview continuity, and measured
provider latency/cost remain BLOCKED. This candidate supports honest omission
handling but cannot prove what a real model will answer. No GO claim or issue
closure is warranted. Rollback is the focused context commit; no migration or
data conversion is needed.
