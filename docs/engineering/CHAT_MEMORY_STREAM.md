# Chat Memory streaming contract

Audited against `main` at `1d4abc7619496abcf2684907ed9233d7835e35c2` on 2026-10-09.

The chat route, automatic Web/GitHub Action path, and Deep Research path all use the Context Engine. When Recall retrieves owner-authorized memory, its diagnostics include `type: memory`, `label: Saved memories`, and an included/not-used state. No memory content belongs in this payload.

`readChatSse` previously rejected those values in both the initial `start` event and the later `context` event used by Actions. The browser therefore treated an otherwise valid response as a transport failure. The fix adds the existing Memory diagnostic values to the strict schema; all other event validation, completion/persistence ordering, authorization, and prompt-injection boundaries stay intact.

## Reproduction and verification

`tests/unit/recall-stream.test.ts` builds actual Context Engine diagnostics and feeds them through the browser's SSE parser. Both cases failed with a Zod enum error before the fix and pass afterward. `tests/e2e/recall-stream.spec.ts` verifies that either event path renders the completed answer, exposes Copy, releases Stop, and avoids a recovery notice using a mocked stream and mocked message-persistence action.

Commands:

```sh
npm test -- tests/unit/recall-stream.test.ts tests/unit/ai-sse.test.ts
npx playwright test tests/e2e/recall-stream.spec.ts --workers=2
```

These are contract/UX measurements, not model-quality measurements. Live provider outputs, authenticated Preview persistence, latency, and provider cost remain BLOCKED without dedicated test access and an approved evaluation budget. See [the V2 evaluation gate](RESPONSE_QUALITY_V2.md) and [issue #80](https://github.com/habiibullahm/nibie-code/issues/80).
