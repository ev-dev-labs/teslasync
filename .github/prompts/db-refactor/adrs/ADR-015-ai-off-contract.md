# ADR-015 — AI-Off Contract: AI is strictly additive

**Status:** Accepted
**Date:** Phase-50
**Owner:** Phase-50 AI Adoption working group
**Related:** ADR-001 (JSONB policy), ADR-007 (engine strategy), ADR-014 (alert message template)
**Amends:** none

---

## Context

Phase-50 introduces large-language-model and ML capabilities across
~40 surfaces (chatbot, NL alert/automation builders, narrative
digests, RAG help, anomaly explanations, ML anomaly baselines, range
prediction, charging-curve clustering, and many more — see the
phase-50 methodology). TeslaSync is a **self-hosted owner's app**
operated by individuals running it on their own hardware, often on a
home network without internet egress to commercial AI providers.

A non-trivial fraction of users will refuse AI for one or more of the
following reasons, and the project must continue to serve them
first-class:

1. **Privacy** — they do not want telemetry (positions, charging
   patterns, alert payloads, drive narratives) sent to OpenAI,
   Anthropic, or any third party.
2. **Cost** — they do not want metered billing tied to vehicle
   activity. A mis-configured rule that fires once per telemetry
   batch can run up real money on a per-token API.
3. **Hardware** — they cannot run a local model. Ollama needs ≥6 GB
   of RAM for the smallest useful model and a GPU for any responsive
   experience. A Raspberry Pi deployment cannot host one.
4. **Trust / determinism** — they want behaviour they can audit.
   Pattern-matching chatbots and z-score anomaly detection are
   inspectable; LLMs are not.
5. **Offline / air-gapped** — they run TeslaSync on a network with
   no outbound internet, OR on a corporate network where outbound
   traffic to AI providers is policy-blocked.
6. **Regulatory** — they live in a jurisdiction where sending vehicle
   telemetry to a foreign provider is restricted.

The project's AI adoption MUST honour all six refusal modes
simultaneously and forever. AI is never a hard dependency.

## Decision

**AI is strictly additive. Every AI capability is a clean opt-in
layer on top of an unchanged non-AI baseline. Disabling AI returns
the app to behaviour functionally indistinguishable from the
pre-Phase-50 release.** Codified by the following invariants:

### Invariant I1 — Default-off

The shipping default for the new `settings.ai_mode` column is
`'off'`. A fresh install or upgrade from a pre-Phase-50 version
performs no AI calls, requires no provider configuration, and exposes
no AI UI surfaces until the user explicitly enables AI in Settings.

### Invariant I2 — Three modes, one flag

`settings.ai_mode` is one of:

| Value | Meaning |
|---|---|
| `'off'` *(default)* | All AI surfaces disabled. No provider config required. Behaviour identical to today's heuristic implementations. |
| `'local'` | Only local providers (Ollama, llama.cpp, OpenAI-compatible self-hosted endpoints whose host is RFC1918 / loopback) are accepted. Cloud providers are rejected at the config layer. |
| `'cloud'` | User has opted into a cloud provider (OpenAI, Anthropic, Google, Azure OpenAI, etc.). Per-feature toggles still apply. |

Mode upgrades require an explicit user action in Settings. The
backend never silently promotes the mode (e.g. on update).

### Invariant I3 — Non-AI baseline must remain

Every AI feature has a corresponding non-AI baseline implementation
that ships and stays maintained. Examples:

| AI feature | Non-AI baseline |
|---|---|
| LLM Chatbot | Existing pattern-matching chatbot (`chatbot_handler_chat.go`) |
| LLM weekly digest narration | Template prose digest |
| LLM anomaly explanation | Z-score anomaly with static `safeRanges` |
| NL alert builder | Manual `AlertStudioPage` form |
| NL automation builder | Manual `AutomationBuilderPage` form |
| RAG app help | Static `?` tooltips and docs links |
| ML learned anomaly baselines | Hardcoded `safeRanges` map |
| Per-drive coaching narrative | Existing stat cards |

Baselines are NOT removed when the AI version ships. They are the
canonical behaviour for `ai_mode='off'` users.

### Invariant I4 — Off mode performs zero outbound AI calls

When `ai_mode='off'`:

- No HTTP request is made to any AI-provider hostname. Verified by an
  integration test (`ai_off_no_egress_test.go`) that mocks the HTTP
  client and asserts zero calls to a provider hostname allowlist.
- No background job pulls AI work (the AI dispatcher's `Tick()`
  short-circuits at the mode gate).
- No AI-related rows are written to `ai_call_log` (the table exists
  but stays empty).
- No outbound SSE/websocket connection is opened to any AI provider.
- Fingerprint hashes, embeddings, summaries, etc. are not computed or
  stored on the server.

### Invariant I5 — Off mode hides AI UI surfaces

When `ai_mode='off'`:

- AI-only React components are not rendered (returned `null` early
  via the `useAiEnabled(feature)` hook). They are not greyed out, not
  shown disabled with a tooltip — they simply do not appear.
- Routes that exist solely for an AI feature (e.g. `/ai/chat-v2`) are
  not registered in the React router.
- The Command Palette, Search, and Recently-Viewed lists do not
  surface AI-only commands.
- The Settings → AI section shows a single banner: "AI features are
  off. Enable to opt in." plus the mode picker. Per-feature toggles
  are not rendered until the user picks a mode.
- i18n strings for AI features are still loaded (no chunk explosion
  per locale), but the bundles that ship the SDK and tokenizers are
  lazy-loaded and never fetched in off mode.

### Invariant I6 — Off mode handlers return 404

Backend AI endpoints (any route registered under `/api/v1/ai/...`)
return `404 Not Found` when `ai_mode='off'`, NOT `200` with an empty
body and NOT `503`. A 404 reflects the truth: the route is
functionally non-existent for this user. Existing non-AI endpoints
(e.g. `/api/v1/chat` for the heuristic chatbot, `/api/v1/anomalies`
for the z-score detector) keep their current behaviour.

### Invariant I7 — Per-feature opt-in inside non-off modes

Even when `ai_mode='local'` or `'cloud'`, every AI feature has its
own boolean toggle in `ai_features` (a JSONB column on
`settings`, keyed by feature ID — e.g. `chatbot_llm`,
`alert_builder_nl`, `digest_narration`, `ml_anomaly_baselines`).
Default for every feature on first migration: `false`. Enabling the
mode does NOT auto-enable any feature. Users must check each box.

This means a user can run `local` mode with only `chatbot_llm` and
`app_help_rag` enabled while keeping every other AI surface off.

### Invariant I8 — Existing AI-authored data survives a downgrade

When the user disables AI, data that AI helped produce remains
intact:

- Alert rules created via NL builder stay in `alert_rules` exactly
  as if the user had created them manually. They have no special
  flag and no special behaviour. The rule engine evaluates them
  identically.
- Automations created via NL builder stay.
- Chat history stays in `chat_messages`.
- Geofences auto-named by AI keep their names.
- Year-in-review narrative once generated is cached in
  `analytics_narratives` and replayable without further AI calls.

The only thing disabled is *new* AI generation. Past output is
treated as user content.

### Invariant I9 — Provider keys never leak in off mode

In off mode, the Settings page does not display previously-saved
provider API keys (even masked). It does not include them in
settings export bundles. They remain in the database (so re-enabling
AI doesn't lose them) but are inaccessible to the frontend.

### Invariant I10 — AI-off contract is enforced by the type system

A typed React HOC `withAiFeature(featureId)` wraps every AI-only
component. The wrapped component cannot be rendered without an
enabled feature flag — the wrapper short-circuits to `null` when
disabled. Unwrapped AI components are rejected by a custom ESLint
rule (`teslasync/ai-component-must-be-wrapped`). On the backend, a
typed `ai.GuardedHandler` middleware wraps every AI route and
enforces the same gate. Adding an AI route without going through
the guard is a CI failure.

### Invariant I11 — Final gate proves the contract

Phase-50's `9999-final-gate` runs an explicit AI-off invariant suite:

1. Boot the app with `ai_mode='off'`.
2. Walk every page in the route registry with Playwright.
3. Assert no network call to any provider hostname allowlist.
4. Assert no `<button>` or `<a>` containing the strings "Ask AI",
   "✨", "Generate with AI", "Explain", or any i18n key under the
   `ai.*` namespace is in the rendered DOM.
5. Hit every `/api/v1/ai/*` route and assert 404.
6. Confirm `ai_call_log` row count is 0 after the full walk.

If any assertion fails, the gate is BLOCKED and the phase does not
ship.

### Invariant I12 — Off mode disables AI client + background artifacts

Provider calls and `/api/v1/ai/*` are not the only egress vectors.
When `ai_mode='off'`:

1. **Service worker** must not precache, install, or serve AI-only
   chunks. The build emits two manifests; the runtime selects based
   on `ai_mode` at install time and on every `controllerchange`.
   AI-tagged chunk names (`ai-*`, `chunk-ai-*`) are excluded from
   the off manifest.
2. **AI web-push subscriptions** (rows in `push_subscriptions` with
   `kind LIKE 'ai_%'`) MUST NOT receive payloads. The push fan-out
   worker filters by `kind` AND the recipient's current `ai_mode` /
   feature flag at delivery time, NOT at enqueue time.
3. **AI background jobs** (digest pregen, embeddings indexer, ML
   trainers, KPI watch, share-card pregen, PDF generators, etc.)
   re-check `ai_mode != 'off'` AND per-feature opt-in at the moment
   of execution. A flip-to-off cancels in-flight work via context
   cancellation; queued work is dropped (with a metric), not silently
   executed.
4. **Existing non-AI endpoints** MUST NOT add or change fields based
   on whether AI is on. Any AI-derived field lives ONLY on
   `/api/v1/ai/*`. Test: response schema of every baseline route is
   byte-identical between off and any AI-on combination, modulo
   timestamps + IDs.
5. **Client storage** (localStorage, sessionStorage, IndexedDB) must
   not retain provider config, prompt payloads, AI tokens, or
   AI-only feature state when off. A `clearAiClientState()` runs on
   every settings save that lands `ai_mode='off'`.

Final-gate proof: scan the served service-worker manifest for `ai-*`
chunks, fixture-send to AI-tagged push subs and assert zero
deliveries, run a 5-minute off-mode soak and assert zero `ai_*` job
executions, snapshot-compare baseline endpoints across modes,
verify post-flip-off browser storage contains no `ai.*` keys.

## Consequences

### Positive

- The "I don't want AI" user has a first-class experience with
  literally zero new dependencies and zero new behaviour to learn.
- Privacy-strict and air-gapped deployments work out of the box.
- Adopters can grow into AI feature-by-feature without committing
  to all of it.
- The non-AI baseline implementations stay maintained as a
  permanent fallback — they are not deprecation candidates.
- Compliance / audit answer "does the app send vehicle data to
  OpenAI?" is a verifiable "no" for off-mode users.

### Negative

- The codebase carries **two implementations** for each upgraded
  surface forever (heuristic + LLM). Mitigated by the foundational
  tool-use framework (slice F4) which keeps the LLM path thin: it
  proposes inputs to the same typed handlers the heuristic path
  uses.
- Marketing screenshots showing AI features must be qualified
  ("Optional. Disabled by default.").
- Test matrix grows: every AI feature needs both an "AI on" suite
  and an "AI off" assertion.
- The eval harness must pass with provider mocked, so dev workflows
  don't require live API keys.

### Neutral

- Settings export/import format includes `ai_mode` and
  `ai_features` (additive, no breaking change to existing bundles).
- Helm/Docker compose stays unchanged for off users; new optional
  Ollama service is documented but not required.

## Compliance checklist (apply to every Phase-50 slice)

A slice that adds an AI capability is NOT done until the per-slice
log shows:

```
=== AI-OFF CONTRACT ===
I1 default-off:     PASS  (migration default verified)
I3 baseline intact: PASS  (heuristic test still green)
I4 zero egress:     PASS  (off-mode integration test)
I5 hidden UI:       PASS  (Playwright off-mode walk)
I6 404 routes:      PASS  (curl -s -o /dev/null -w '%{http_code}')
I7 per-feature:     PASS  (toggle off → handler returns 404 in 'cloud' mode)
I10 type system:    PASS  (component wrapped, ESLint rule passes)
I12 client/bg:      PASS  (no ai-* SW chunks, no ai_* job exec, no ai.* client storage)
=======================
```

A slice that omits this footer is BLOCKED.

## Future work (out of scope for Phase-50)

- Federated / on-device inference (WebGPU) so even local mode does
  not need a server-side runtime.
- Differential privacy noise injection for opt-in telemetry.
- Per-organization AI policy (RBAC controlling which roles can
  enable which features) — currently all-or-nothing per user.

## References

- Phase-50 methodology: `.github/prompts/db-refactor/phase-50-ai-adoption/0000-methodology.prompt.md`
- F0 invariant slice: `.github/prompts/db-refactor/phase-50-ai-adoption/0001-F0-ai-off-contract.prompt.md`
- Final gate: `.github/prompts/db-refactor/phase-50-ai-adoption/9999-final-gate.prompt.md`
