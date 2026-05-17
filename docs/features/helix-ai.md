# Helix AI

Helix is the AI layer inside TeslaSync. Not a chat bolt-on, not a third-party plugin — a structured set of features that sit alongside the rest of the product, share its database, respect its auth, and are turned on one at a time.

This page is the in-app feature summary. For the full reference — every feature, the decorator chain, RAG pipeline, tool dispatch, the contract for adding a new feature — go to the [Helix AI guide](/guide/helix-ai).

## Why Helix exists as a separate thing

The TeslaSync platform already had analytics, alerts, drives, charging, automation. Adding AI as an afterthought — sprinkling a chat bubble into every page — would have produced an unmaintainable mess and would have made the "off-by-default" promise impossible to keep.

Helix is a separate layer with its own:

- **Brand** — the double-helix mark from `web/src/components/branding/HelixMark.tsx`, visible in the sidebar and on every AI surface
- **Registry** — `internal/ai/features/registry.go` is the single source of truth for which features exist
- **Decorator chain** — trace → audit → cost → ratelimit → redact, applied to every call
- **Audit log** — `ai_call_log` records provider, feature, tokens in, tokens out, cost, latency, error
- **Settings page** — **Settings → Helix** is the one place you opt features in or out

If you never enable a Helix feature, the platform is unchanged from how it worked before AI was added. That is a feature, not an accident.

## The 54 features, grouped

Rather than list them alphabetically, here is what they actually do:

### Narratives — Helix writes prose about your data

Weekly digest narration, year-in-review narration, drive-detail coaching, charging session narration, vehicle anniversary narration, monthly cost summary, anomaly explanations, range projection walkthrough, battery degradation insights, energy site narration, sleep efficiency narration, daily brief, charging-cost trend, fleet readiness preview.

### Natural-language builders — describe it in English, Helix proposes the structured version

NL alert builder, NL automation builder, NL filter builder, NL chart builder, NL geofence builder, NL data query, NL export builder, NL dashboard layout, NL routing rule.

### Predictions — Helix scores or projects something

Range projection explainer, charging suggestion, departure-time suggestion, automation suggestion, alert tuning suggestion, quiet hours suggestion, geofence-aware automation, charging fingerprint clustering, cost forecast.

### Explainers — Helix tells you why a model said what it said

Cross-rule conflict detection, anomaly spotlight, route efficiency explainer, regen anomaly explainer, vampire drain explainer, sentry-event narrator, automation rationale, FSM state-machine debugger narrator.

### Multimodal — Helix uses images, not just text

Image-aware drive notes, dashcam summary (when configured), vehicle inspection helper.

### Triage & ops helpers

Log summarisation, trace summarisation, feedback queue prioritisation, data-repair suggestions, schema-drift detector, PII redaction for shared exports, support-ticket triage helper, on-call paging assistant, release-notes drafter.

### The chatbot

A single feature ID — `chatbot-llm` — wires the **Helix** sidebar entry to a chat surface that has access to a curated tool set (fleet lookup, drive lookup, charging lookup, alert lookup, automation lookup, RAG over the docs corpus). The chatbot is the most visible Helix feature but it is also just one of the 54.

Plus 3 ops-only registry entries (`__usage__`, `__redaction_bypass__`, `ai-provider-health`) that aren't user-toggleable — they exist so the platform itself can call the AI infrastructure without violating the off-by-default contract.

## Providers

Helix is provider-agnostic. The same feature works against any of these:

| Provider                | Mode      | Where it shines                                            |
| ----------------------- | --------- | ---------------------------------------------------------- |
| Ollama                  | Local     | Privacy-first deployments, no per-token cost, latency-bound by hardware |
| OpenAI                  | Cloud     | Strong general models, broad tool-use support              |
| Azure OpenAI / Foundry  | Cloud     | Enterprise customers with Azure agreements                 |
| Anthropic               | Cloud     | Long-context narratives, structured prose                  |
| Mock                    | Dev only  | Tests; never used at runtime                               |

Switch the active provider with one env var (`AI_PROVIDER`). Per-feature model overrides exist for cases where you want narratives from a stronger model and tool-use from a cheaper one.

## Safety, by construction

Every call goes through five decorators, applied outermost first:

1. **trace** — OpenTelemetry span with provider, model, feature, token counts
2. **audit** — `ai_call_log` row with everything the trace has plus cost
3. **cost** — refuses calls that would push the user past `AI_DAILY_BUDGET_USD`
4. **rate-limit** — per-user requests per minute via Redis counters
5. **redact** — strips VINs, GPS coordinates, emails, driver names from the payload before it leaves your server

The redactor is on by default. You can turn it off (`AI_REDACTION_ENABLED=false`) but you have to do it deliberately. The platform won't quietly let your data leak.

## What "off by default" really means

For every Helix feature:

- The backend HTTP route returns `404` until you flip the toggle. This is enforced by `g.Wrap("<feature-id>", handler)` in `internal/api/ai_routes.go`.
- The React component renders `null` until you flip the toggle. This is enforced by `withAiFeature('<feature-id>')` wrapping every AI component.
- The CI vet (`tools/aivet`) fails the build if either contract is missing.
- The Phase-50 final-gate test suite verifies the contract holds across the entire registry.

A new Helix feature that ships in "on by default" mode is a CI failure, not a code review nit.

## Cost guardrails

If you're using a cloud provider:

- `AI_DAILY_BUDGET_USD` is a hard ceiling. Helix refuses new calls once the day's spend would exceed it. The user sees a clear "daily budget reached" message; the rest of the platform keeps working.
- `AI_RATE_LIMIT_PER_MIN` caps requests per user per minute.
- The **Settings → Helix → Usage today** card reads live aggregates from `ai_call_log` so you can see what's consuming budget.
- Per-feature toggle gives you fine control — keep narratives on (cheap), keep image analysis off (expensive) until you actually need it.

If you're using Ollama, the budget is moot but the rate limit still prevents a runaway dashboard from overwhelming your GPU.

## Where to learn more

- [Helix AI guide](/guide/helix-ai) — every feature, every contract, every escape hatch
- [Configuration → Helix AI settings](/guide/configuration#helix-ai-settings) — every env var
- [API Endpoints → Helix AI](/guide/api-endpoints#helix-ai) — every route
- [Architecture → Helix AI flow](/guide/architecture#helix-ai-flow) — the request diagram
- [Adding features](/contributing/adding-features) — the workflow for adding a new Helix feature
