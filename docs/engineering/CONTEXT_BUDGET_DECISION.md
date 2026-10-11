# Context budget experiment and decision

Decision, October 11, 2026: retain the server-owned 16,384-token policy ceiling
and 2,048-token output reserve for Fast, Balanced and High. The experiment does
not justify a deployed per-mode change. No provider calls, model escalation,
output-limit changes or new paid CI evaluation were made.

## What the numbers mean

`lib/ai/registry.ts` supplies product allocation ceilings, not verified deployed
provider capabilities. `budgetLimits` reserves the smaller of 2,048 and 25% of
the policy window, leaving 14,336 estimated input tokens today. The estimator is
`ceil(text.length / 4)`; it is not a provider tokenizer or a billing measurement.

The policy reserve is distinct from provider output configuration. Fast's
compatible gateway request uses an 8,192-token output limit for reasoning
headroom. Balanced/High retain their existing provider defaults. The 2,048
reserve is not an enforced output cap or a hard dollar-spend guarantee. Do not
infer verified provider context windows, gateway prices or billed limits from
these registry values.

## Reproducible offline experiment

```sh
CONTEXT_ALLOCATION_REPORT=docs/engineering/context-allocation-evaluation.json \
  npx vitest run tests/unit/context-allocation-evaluation.test.ts
```

The committed JSON also records estimated provider-message text after serialization
(`providerMessageTextTokens`), including the data preamble but excluding provider
role framing/tokenizer overhead. Current fixtures range up to 14,333 text tokens
against 14,336 allocated; this narrow margin is another reason to avoid a new
capability or guaranteed-fit claim. The JSON records 20 sanitized cases: short request, 31 earlier turns,
Room/files/current attachment, covered summary with Room/files, and a summary
with a gap at the 32-message fetch boundary. Each runs at 8,192, 16,384, 32,768
and 65,536 policy tokens with the same 2,048 reserve. These are experimental
allocations, not verified model windows. Tests preserve the current correction,
core policy, continuous retained history and summary freshness. Existing Context
Engine/continuity tests cover authority and stale-summary behavior in more depth.

| Policy window | Long-thread raw earlier turns | Room/files raw earlier turns | Covered-summary case | Estimated-bound violations |
| --- | ---: | ---: | --- | --- |
| 8,192 | 4 | 4 | Summary dropped | 2 of 5 |
| 16,384, current | 12 | 5 | Summary retained; 5 raw turns | 0 of 5 |
| 32,768 | 28 | 20 | Summary retained; 5 raw turns | 0 of 5 |
| 65,536 | 31 | 31 | Summary retained; 5 raw turns | 0 of 5 |

At 8,192, Room/files and summary/Room/files report 6,286 and 6,233 estimated
input tokens against 6,144 available. The smaller candidate is rejected: source
rendering/diagnostic accounting needs separate investigation before adopting a
lower limit. The existing summary/fetch-gap is rejected at every tested window,
so an older summary cannot bridge an omitted correction. At the current policy,
Room/files and covered-summary cases report 14,192 and 14,245 estimated tokens.

Larger windows retain more unsummarized history. They do not change allocation
for this valid covered-summary case, because the summary already replaces the
covered turns. More retained text alone does not establish answer quality,
latency, relevance or acceptable spend. Five scenarios do not prove all inputs
fit; these are bounded fixture results.

## Evidence required for a future change

Verify effective deployed route capabilities and gateway pricing, then compare
changed-input cases with bounded spend, real outputs, source fidelity and human
review. Record TTFT, completion latency, tokens and cost. The proposed 10%
median/p95 latency gate remains unmeasured. Issue #80's matched-input acceptance
is separate from an experiment that deliberately changes context.

Current-request/system authority, protected recent suffix, summary bridge,
truncation diagnostics, authorization and fallback ceilings remain unchanged.
A later justified budget change should be a separate reversible server-only PR.
