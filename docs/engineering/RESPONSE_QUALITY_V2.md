# Response Quality V2 — Issue #73

## Findings at baseline (main ea9c9bd, 2026-10-09)

This is a **code-path diagnosis, not a real-model quality score**. At assessment, no provider credentials, customer chat samples, or signed-in Preview evaluation account were available in this execution environment. Before/after observed quality: **BLOCKED / N/A**. Do not substitute synthetic scorer tests or prompt substring checks for model output evaluations.

- The system already receives an adaptive response-depth policy (Default, Concise, Detailed), as the final authoritative core instruction. Existing unit tests prove its delivery, not its effectiveness.
- Two independently verifiable **contradictions** were in the core product facts: "No tools or other-conversation memory" despite server-owned Actions/Memory; "Only explicitly selected file text is used" despite authorized automatic Room-file retrieval. This PR corrects only those stale descriptions, without granting tools or memory access.
- \`contextCapabilitiesFor\` declares a conservative 16,384-token context envelope and reserves 2,048 tokens for generation planning. That reserve is **not** an actual max-output parameter for OpenAI; the Fast gateway has an explicit \`max_tokens:8192\` for reasoning headroom. Do not infer provider hardware windows or increase output limits from these values.
- \`buildContext\` protects the newest turns, then budgets profile/Room/pins/files/web/summary/older turns. \`FETCH_CAP=32\`; context truncation is possible. The route logs \`context.built.truncated\`, \`estimatedTokens\`, and \`recentMessageCount\` without private text.
- Normal chat SSE explicitly rejects incomplete provider finishes including \`finish_reason=length\`, and logs \`finishReason\` + TTFT. Early end/Stop can still look shallow to a tester; inspect request-correlated logs before attributing to reasoning effort.
- Routing is Fast=Sumopod/DeepSeek V4.1 Flash, Balanced=OpenAI/GPT-6 Luna, High=OpenAI/GPT-6.1 Sol with model overrides. Balanced follows its default effort unless configured, High sends configured/default high, Fast sends no reasoning effort. This PR does **not** change routing, effort, limits or spending.
- Provider compatibility **must be verified against the active deployment** before changing params. Fixture-only tests are not provider capability verification.

## Reproducible actual-output evaluation (no paid API calls)

\`tests/fixtures/response-quality-v2.json\` contains 30 sanitized bilingual prompts: technical explanations, coding, troubleshooting, architecture, comparison, multi-turn, Room, file, web, research, brevity and detailed requests. Context/history fixtures are *test inputs*, not instructions to fetch real private files. External/source claims should be tested with provided redacted evidence and source metadata; avoid claiming a live search when none ran.

1. Freeze baseline and candidate commit SHAs and record the active deployment's **effective** model/provider, reasoning effort, configured route overrides, response-depth setting, input context diagnostics (\`truncated\`, included history/summary/files), finish reason, latency, output tokens, and cost where available. Never record hidden reasoning, credentials or raw private transcripts.
2. With a separately approved **hard provider spend budget** and a dedicated test account, run matched case/mode pairs through the real application on baseline Preview and candidate Preview, using **identical** user text, history, context, tool/source fixtures and model configuration. Do not run all 90 calls automatically. If any provider fails a capability probe or credentials are absent, record that mode as BLOCKED. A changed model/effort or truncated-context status is explicitly **not comparable** in the harness.
3. Save redacted real response text *privately* as JSON files \`--baseline\` and \`--after\` with this shape:

\`\`\`json
{
  "runs": [{
    "caseId": "database-index-en",
    "mode": "Balanced",
    "model": "effective-model-id",
    "provider": "effective-provider",
    "reasoningEffort": "provider_default",
    "finishReason": "stop",
    "latencyMs": 1200,
    "outputTokens": 340,
    "contextTruncated": false,
    "responseDepth": "balanced",
    "fixtureFingerprint": "SHA-256 from fixtureFingerprint(loadCases().find(c => c.id === caseId))",
    "historyFingerprint": "none",
    "roomFingerprint": "none",
    "filesFingerprint": "none",
    "toolsFingerprint": "none",
    "response": "Actual redacted output from the model",
    "reviewer": "reviewer-id",
    "reviewNotes": "Checkable references to answer mechanics, known caveats and missing facts",
    "sourceFidelity": "human_reviewed",
    "critical": false,
    "ratings": {
      "accuracy": 2,
      "completeness": 2,
      "whyHow": 1,
      "example": 2,
      "tradeoffs": 1
    }
  }]
}
\`\`\`

4. Score with \`npm run eval:response-quality -- --baseline private-before.json --after private-after.json --out private-report.md\`. The scorer consumes **actual, saved response text**, requires \`sourceFidelity: "human_reviewed"\` plus reviewer ratings for the case's relevant rubric dimensions, and reports *matched* before/after only. It never invokes an LLM, never inspects hidden reasoning, and never estimates quality by response length. Missing input fails BLOCKED rather than inventing scores.
5. Rubric per dimension: 0 absent/incorrect, 1 partial or weak, 2 accurate/useful. Evaluate factual accuracy, task completeness, public why/how rationale, helpful example, conversation continuity, meaningful tradeoffs, grounding/citations, and requested brevity. Reviewers must fact-check security, factual claims and all stated external sources. A response may be verbose and score poorly.
6. Acceptance: at least 80% **on comparable reviewed cases**, **strict positive improvement vs baseline** (identical scores are FAIL), **hard non-regression on accuracy/completeness**, **minimum coverage of 5 comparable pairs per mode and 15 total**, **category floors** (technical, debugging, architecture, follow-up, grounding) and **both Indonesian and English**, zero critical factual/security issues, zero explicit brevity failures or regressions, matched model/provider/effort/truncation/`finishReason`/responseDepth/fixture/context fingerprints, complete finishes only (`stop`; `length`/error excluded from fair pairs), and human-reviewed source fidelity on every run. One comparable pair is not enough for PASS. Do not call the PR release-ready while real-model output validation is BLOCKED.

### October 12 offline audit and next real-output package

The scorer previously treated missing context fingerprints as empty strings and
missing response depth as Default. Both sides could therefore qualify for PASS
without evidence that their inputs matched. Configuration fields separated by
`|` could also collide. The scorer now requires explicit provenance, checks the
fixture-content digest, and compares structured configuration fields. These
are evaluation-integrity fixes; they do not prove better generated answers.

Generate the current fixture digests without network or credentials:

```sh
node --input-type=module -e 'import {loadCases, fixtureFingerprint} from "./scripts/response-quality-eval.mjs"; console.log(JSON.stringify(loadCases().map(c => ({caseId:c.id, fixtureFingerprint:fixtureFingerprint(c)})), null, 2))'
```

For every real run, record the *effective* context supplied to that request.
Use SHA-256 digests for history (including the applied summary and its coverage),
Room instructions/brief/Pins, files/attachments, and tools/Web/Memory evidence.
Use `none` only when that category is known to be absent; unknown or failed
capture is BLOCKED. Do not copy `none` from the example into a populated case.
Retain the redacted inputs privately so another reviewer can reproduce them.
The fixture digest covers the complete committed case object, including its
prompt, dimensions, and synthetic history/context; a reused id does not prove
the same fixture. Missing saved depth must be captured rather than inferred.

Before any paid evaluation, freeze this separate run manifest privately:

| Required record | Gate |
| --- | --- |
| Baseline and candidate full commit SHAs; exact Preview deployment SHAs | BLOCKED until both deployments and signed-in test access are verified |
| Actual model/provider ids, route overrides, supported reasoning parameters, output accounting, image/tool support where relevant | BLOCKED until verified for each effective gateway route; registry defaults are configuration, not capability proof |
| Dated provider/gateway price basis, currency, cached/input/output and reasoning billing semantics | BLOCKED until verified; do not infer prices from weekly credits |
| Written budget authorization and enforceable hard aggregate spend cap, including capability probes, summaries and retries | BLOCKED; credentials alone never authorize spend; no executor is added by this package |
| Selected case/mode pairs and maximum requests; retry policy | At least 5 comparable pairs/mode and 15 total; a minimum run is 30 successful baseline/candidate calls, plus separately capped probes/retries/maintenance |
| Independent human reviewer identity, factual source checks, ratings and review notes | BLOCKED until a human reviews the actual redacted outputs; an agent or synthetic scorer fixture cannot satisfy this gate |

The configured code routes remain Fast = Sumopod/DeepSeek V4.1 Flash,
Balanced = OpenAI/GPT-6 Luna, High = OpenAI/GPT-6.1 Sol (server overrides may
change them). Fast has 8,192 configured output tokens; Balanced retains provider
default effort unless configured and High defaults to high. All three retain
the 16,384/2,048 application allocation policy. Active provider capabilities,
pricing, measured latency/cost, and live answer scores remain **UNVERIFIED /
BLOCKED**. Run the existing offline scorer only after authorized captures and
human ratings exist. Do not run synthetic test records through the CLI and
present their arithmetic PASS as Issue #80 acceptance.

## Verification and exclusions

- Existing \`npm run test:response-quality\` proves the policy/context contract; \`npm run test:quality:v2\` verifies the offline actual-output scoring harness using **synthetic** arithmetic fixtures only, and explicitly does **not** prove response improvement.
- PR Guard runs lint, typecheck, unit tests, release check and isolated Postgres integration. The dedicated V2 workflow additionally runs the scoring-harness tests, production build, and mock-auth-independent Playwright streaming/composer regressions.
- A signed-in Preview smoke and real model before/after scores require real test credentials and an approved spend budget; report BLOCKED if unavailable. Never merge, deploy, or turn on automated paid eval from this PR.
- This change is intentionally limited to correcting obsolete product capability descriptions, improving coverage, and making falsifiable quality comparison possible. **No claim of better model-generated answers** is made until a controlled live comparison is completed.
