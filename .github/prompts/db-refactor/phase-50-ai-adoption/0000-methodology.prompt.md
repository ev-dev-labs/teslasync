---
description: "Phase-50 — AI Adoption (Foundation, Upgrades, New AI-Native Features, ML)"
---

# Phase-50 — AI Adoption (Foundation, Upgrades, New AI-Native Features, ML)

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0000-methodology.log |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no eturn nil, // TODO, panic("not impl")
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - git status outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| === PREFLIGHT === | Branch, predecessor logs, and dirty-tree check. |
| === SURVEY === | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| === REASONING === | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| === CHANGES === | Summary of production, test, registry, i18n, prompt, and golden changes. |
| === GATE === | Full command transcripts with EXIT markers. |
| === COMMIT === | git add/commit transcript, or blocked-log-only commit transcript. |
| === AI-OFF CONTRACT === | ADR-015 footer with evidence for every invariant this slice touches. |
| === STATUS === | Final EXIT=<int> and STATUS=<DONE|BLOCKED> markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in === PREFLIGHT ===.
3. Survey the current code and document the baseline in === SURVEY === before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into === GATE ===.
6. If any gate fails, stop with STATUS=BLOCKED and commit only the log.

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains EXIT=0 and STATUS=DONE on their own lines, the ADR-015 footer is present with evidence, and git status --short contains only allowed files before commit.

## Commit

Use a conventional commit for this slice and include the required trailer:

~~~text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
~~~

## Blocked Path

If a predecessor is missing, verification cannot run, or any gate fails, write the log with:

~~~text
=== STATUS ===
EXIT=1
STATUS=BLOCKED
~~~

Commit only the blocked log and include the command output that proves the blocker.

> **Branch:** `feat/ai-adoption` off `main`. Do NOT branch off Phase-49
> alert-engine work.
>
> **ADR:** [ADR-015 — AI-Off Contract](../adrs/ADR-015-ai-off-contract.md)
> is the binding constraint for every slice in this phase. Read it first.
>
> **User mandate (verbatim from 2026-05-13 conversation):**
>
> 1. *"right now we don't have ai features. so can you check and see if
>    we can add any ai? don't create prompts yet lets finalize first then
>    will create prompts"* — full audit done, ~40 candidate features
>    identified across 11 domains.
> 2. *"if any user doesn't want to lay of ai or don't want to use then?"*
>    — codified as ADR-015. AI is strictly additive, off by default,
>    with a non-AI baseline that always remains.
> 3. *"ok great lets add prompts for all these 40 features and make sure
>    we added this AI off in ADR. will feat/ai-adoption branch. And use
>    DRY principle. we need to use state of art design patterns. we
>    need true state of art system. don't cut corners and don't rush."*
>
> **Discipline:** vertical slices, one commit per slice, log per slice in
> `.github/prompts/db-refactor/logs/phase-50-NNNN-<slug>.log` with the
> compliance footer from ADR-015 plus the standard
> `=== STATUS === EXIT=N STATUS=DONE/BLOCKED`.

---

## Problem statement

TeslaSync presents itself as having an "AI Assistant" but it does not.
The chatbot is a hardcoded `switch` over substring matches. Anomaly
detection is a static `safeRanges` map plus z-score. Forecasts are
linear projections. Driving "coaching" is a stub handler with no
intelligence. The `polling/predictor.go` is a heuristic. There is no
LLM SDK in the codebase. There is no embeddings store. There is no
RAG. There is no ML model. Users who would benefit from natural-
language interaction with their fleet, narrative summaries of their
drives, intelligent alert-rule authoring, or anomaly explanations,
get none of it today.

Concurrently, a non-trivial fraction of users explicitly do **not**
want AI in their owner's app — for privacy, cost, hardware, trust,
offline, or regulatory reasons. The status quo serves them perfectly.
Any AI adoption must continue to serve them perfectly. ADR-015
codifies this.

## What today actually does

| Concern | Today |
|---|---|
| "AI Chatbot" (`ChatbotPage`) | Hardcoded `switch` over ~20 substring intents in `internal/api/chatbot_handler_chat.go`. Client-side typewriter fakes streaming. |
| Anomaly detection | Static `safeRanges` + z-score in `internal/api/anomaly_handler.go`. |
| Cost / battery / range forecasts | Linear projection / averaging. |
| `driving_coach_handler.go` | Stub handler. No real coaching narrative. |
| Polling predictor | Heuristic. |
| LLM/embeddings/RAG | None. Zero hits across the repo. |
| AI-off contract | None. There is no "AI is off" mode because there is no AI. |
| Provider abstraction | None. |
| Tool-use / function calling | None. |
| Audit log of AI calls | None. |
| Cost cap on AI calls | None. |
| Eval harness | None. |
| Prompt redaction | None. |
| Embeddings store / pgvector | TimescaleDB-HA image bundles `pgvector` (per ADR-007) but the extension is not enabled and no schema uses it. |

## What this phase ships

Three tiers, foundation first:

### Foundation (F-tier — ships before any feature)

| # | Tier | Surface |
|---|---|---|
| 0001 | F0 | **AI-off contract**: schema (`settings.ai_mode`, `settings.ai_features` JSONB), `useAiEnabled` hook, `withAiFeature` HOC, `ai.GuardedHandler` middleware, ESLint rule, off-mode invariant test suite. |
| 0002 | F1 | **Provider abstraction** (port-adapter / hexagonal). `internal/ai/provider` package with `Chat`, `Stream`, `Embed`, `Tools` ports. Adapters: Ollama, OpenAI-compatible, Anthropic. Local-only validator rejects RFC1918-violating hosts when `ai_mode='local'`. |
| 0003 | F2 | **Settings UI** for AI: top-level mode picker, per-feature toggles, provider/model/base-URL/API-key, cost cap, redaction policy. Honors I9 (key never displayed in off mode). |
| 0004 | F3 | **`ai_call_log` table + AI usage card** mirroring `TeslaApiUsageCard`. Columns: model, tokens (in/out), latency, cost (computed), feature ID, user ID, request hash, redacted-payload digest, outcome. |
| 0005 | F4 | **Tool-use framework**: typed tool registry (`ai.Tool` interface with JSON-schema input + output), JSON-schema validation, dispatcher, OpenAI/Anthropic-compatible serializer. Every AI-driven mutation routes through existing typed DTOs (no raw SQL). |
| 0006 | F5 | **SSE streaming infrastructure**: `internal/ai/stream` chunk-encoder, async generator pattern for handlers, frontend `useAiStream` hook. Replaces fake typewriter on `ChatbotPage`. |
| 0007 | F6 | **Eval harness**: `cmd/ai-eval` runner, golden-set YAML format, deterministic tool-call assertions, LLM-as-judge for prose grades. CI job `ai-eval` (advisory in PR, gating on main). |
| 0008 | F7 | **Embeddings + pgvector RAG**: enable `vector` extension, `embeddings` table partitioned by `source_type`, HNSW index, hybrid retrieval (BM25 via `pg_trgm` + dense), chunker, ingestion worker. |
| 0009 | F8 | **Prompt redaction layer**: structural (not regex) PII redactor — VIN, email, lat/long, address, IP, phone. Applied to all outbound prompts unless feature explicitly opts in via `RedactionPolicy.Allow{...}`. |
| 0010 | F9 | **Rate limiter + cost cap**: per-user-per-feature token bucket; daily $ cap; degrade to baseline (heuristic) path on exhaust. |

### Upgrade existing surfaces (U-tier)

| # | Slice | Replaces |
|---|---|---|
| 0011 | U1 | LLM chatbot using F4 tool registry + F5 streaming. Pattern-matcher kept as `ai_mode='off'` baseline. |
| 0012 | U2 | LLM-narrated weekly digest. Template digest stays as baseline. |
| 0013 | U3 | LLM-narrated year-in-review slides. Template slides stay as baseline. |
| 0014 | U4 | LLM-explained anomalies on `AnomalyDashboard`. Z-score detector stays as baseline. |

### New AI-native — conversational + builders (N-tier)

| # | Slice | Value |
|---|---|---|
| 0015 | N1 | NL alert builder → `AlertRule` DTO via tool call. User confirms before save. |
| 0016 | N2 | NL automation builder → automation graph DTO. User confirms. |
| 0017 | N3 | NL search across drives / charges / alerts (RAG over event embeddings). |
| 0018 | N4 | Per-drive coaching narrative — replaces `driving_coach_handler` stub. |
| 0019 | N5 | Charging-session diagnosis (root-cause for trickle/expensive/low-power flags from `chargingAggregation`). |
| 0020 | N6 | App-grounded help via RAG over `/docs/`, runbooks, i18n keys. |

### Driving (D-tier)

| # | Slice |
|---|---|
| 0021 | D1 NL drive search/replay |
| 0022 | D2 Speed-profile insights |
| 0023 | D3 Route-efficiency suggestions |
| 0024 | D4 Auto trip naming |
| 0025 | D5 Trip planner LLM agent |

### Charging (C-tier)

| # | Slice |
|---|---|
| 0026 | C1 Smart-charge schedule suggestion |
| 0027 | C2 Battery health forecast narrative |
| 0028 | C3 Charging-curve fingerprint clustering |
| 0029 | C4 Cost forecast narration |
| 0030 | C5 Vampire-drain explanation |

### Climate / Tires (T-tier)

| # | Slice |
|---|---|
| 0031 | T1 Preheat / precool recommender |
| 0032 | T2 Cabin temperature impact narrative |
| 0033 | T3 Tire-pressure trend reasoning |

### Alerts continued (A-tier)

| # | Slice |
|---|---|
| 0034 | A1 Alert tuning suggestions |
| 0035 | A2 Inbox auto-categorization |
| 0036 | A3 Cross-rule conflict detection |

### Geofences / Locations (G-tier)

| # | Slice |
|---|---|
| 0037 | G1 Auto-name unnamed locations |
| 0038 | G2 Suggest new geofences |
| 0039 | G3 Geofence-aware automation suggestions |

### Analytics narration (X-tier)

| # | Slice |
|---|---|
| 0040 | X1 Period compare narration |
| 0041 | X2 Lifetime stats Q&A |

### Diagnostics / System (S-tier)

| # | Slice |
|---|---|
| 0042 | S1 Incident timeline summarizer |
| 0043 | S2 Data repair suggestions |
| 0044 | S3 Signal explorer NL filter |
| 0045 | S4 Log / trace summarization |
| 0046 | S5 Feedback queue triage |
| 0047 | S6 MQTT / SSE inspector explanations |
| 0048 | S7 State-machine debugger narrator |

### Maintenance (M-tier)

| # | Slice |
|---|---|
| 0049 | M1 Predictive maintenance |
| 0050 | M2 TCO narration |
| 0051 | M3 Software update changelog summarizer |

### Privacy / Safety (P-tier)

| # | Slice |
|---|---|
| 0052 | P1 PII redaction in shared exports |
| 0053 | P2 Quiet hours suggestion |
| 0054 | P3 Safety setting explainer |

### Voice / Watch (V-tier)

| # | Slice |
|---|---|
| 0055 | V1 Voice mode (browser STT/TTS) |
| 0056 | V2 Watch face NL response |

### Power-user (PU-tier)

| # | Slice |
|---|---|
| 0057 | PU1 NL → SQL playground |
| 0058 | PU2 NL → Grafana panel |
| 0059 | PU3 NL dashboard composer |

### Generative (GEN-tier)

| # | Slice |
|---|---|
| 0060 | GEN1 Trip postcard / share-card image generation |
| 0061 | GEN2 Vehicle paint preview |

### ML — non-LLM (ML-tier)

| # | Slice |
|---|---|
| 0062 | ML1 Learned per-vehicle anomaly baselines |
| 0063 | ML2 Range-prediction model |
| 0064 | ML3 Charging-curve fingerprint clustering (statistical sibling of C3) |

### Final gate

| # | |
|---|---|
| 9999 | Phase-50 final gate including the ADR-015 invariant suite. |

---

## State-of-the-art design patterns (DRY guarantees)

The user mandate said "DRY principle … state of art design patterns
… true state of art system. don't cut corners and don't rush." This
is enforced architecturally — not by convention — via the following
shared layers. Each layer is built **once** in the foundation tier
and **reused** by every feature slice.

### P1 — Hexagonal / port-adapter for providers (slice F1)

A single `ai.Provider` port is consumed by every feature. Adapters
(Ollama, OpenAI, Anthropic, mock) implement the port. Features never
import a concrete adapter. Provider selection is runtime via the
`ai.Registry` looking at `settings.ai_mode` + per-feature config.
Adding a new provider does not require touching feature code.

### P2 — Tool-use as the only mutation path (slice F4)

Every AI-driven mutation goes through `ai.Tool` registry, which is a
typed wrapper over the existing handler DTOs. The LLM proposes a tool
call; the framework validates the JSON against the tool's
`InputSchema`; the framework calls the existing handler (NOT a
parallel implementation); the result is shown to the user; the user
confirms before commit. This guarantees:

- Zero new DB write paths added by any AI feature.
- Validation, RBAC, audit, transactions all reuse handler code.
- Removing AI tomorrow does not orphan any business logic.

### P3 — Streaming via async-generator + SSE (slice F5)

`ai.StreamWriter` exposes an `Emit(chunk)` method backed by SSE on
the wire. The frontend `useAiStream` hook wraps `EventSource` with a
typed reducer. Every conversational feature uses this — no
per-feature streaming code.

### P4 — Strategy pattern for prompt building (slice F4 / per feature)

Each feature owns a `PromptStrategy` implementation:

```go
type PromptStrategy interface {
    System() string
    Tools() []Tool
    Context(ctx Context) ([]Message, error)
    RedactionPolicy() RedactionPolicy
    EvalGoldens() []Golden
}
```

Strategies are registered at startup. The dispatcher loops:
`Strategy.Context()` → redact → `Provider.Stream()` → tool calls →
`Strategy.Context()` again until no tool call. No feature reinvents
this loop.

### P5 — Decorator chain on every provider call (slice F1 / F8 / F9 / F3)

Concrete provider is wrapped, in order, by:

1. **RedactionDecorator** (F8) — strips PII per feature's policy.
2. **RateLimitDecorator** (F9) — token bucket per (user, feature).
3. **CostCapDecorator** (F9) — daily cost cap; degrades to baseline.
4. **AuditDecorator** (F3) — writes `ai_call_log` row, hashes
   payload, stores token counts and latency.
5. **TraceDecorator** (existing OTel) — span per call.

Order is locked. Adding a new cross-cut is a new decorator, not edits
to N feature handlers.

### P6 — Compile-time gate for AI components (slice F0)

`withAiFeature(featureId)` HOC and `ai.GuardedHandler` middleware are
the **only** way to expose an AI surface. ESLint rule
`teslasync/ai-component-must-be-wrapped` and Go vet check
`ai-handler-must-be-guarded` fail CI for unwrapped surfaces. This
makes the AI-off contract a type-system invariant, not a discipline.

### P7 — RAG retrieval is a single function (slice F7)

`ai.Retrieve(ctx, query, sourceType, k) → []Chunk` is the only RAG
entry point. Hybrid scoring (BM25 + dense) is hidden behind it.
Every retrieval-using feature calls this — no feature implements its
own embedding query.

### P8 — Eval is data, not code (slice F6)

Goldens live in YAML next to each feature's strategy:
`internal/ai/strategies/<feature>/goldens.yaml`. The runner discovers
all goldens via filesystem walk and runs them against a deterministic
mock provider AND, optionally, a live provider. Adding a new feature
adds a YAML file — no new test harness code.

### P9 — Settings + feature flags as a single typed registry (slice F0 / F2)

`internal/ai/features/registry.go` is the ONE source of truth that
lists every AI feature ID, its display name, its description, and
its default toggle state. The settings UI is generated from the
registry. The `useAiEnabled(feature)` hook reads from the registry.
Adding a feature touches one place.

### P10 — Baseline + AI side-by-side via interface, not branching

Each upgraded surface defines a single interface (e.g.
`ChatResponder`, `DigestNarrator`, `AnomalyExplainer`) with two
implementations: heuristic (existing) and LLM (new). The wiring picks
the implementation based on `useAiEnabled(feature)`. Feature
handlers never branch on the mode internally.

---

## Locked decisions (do not re-litigate)

| # | Decision | Source |
|---|---|---|
| D1 | AI is strictly additive. ADR-015 governs. | User msg 2026-05-13 22:29 |
| D2 | Default provider in 'local' mode = Ollama; default model TBD per PD1. | TeslaSync is a self-hosted owner's app; local-first is the obvious default. |
| D3 | Default in 'cloud' mode = OpenAI-compatible (provider-agnostic). User picks model. Per PD2. | Decision pending user override at scope-finalisation. Set in F2. |
| D4 | Mutations are propose-only with explicit user confirm. No autonomous-with-undo. | Safety + ADR-015 trust. User can opt into autonomous later. |
| D5 | Per-feature opt-in is fine-grained (one toggle per feature). Top-level mode is the gate. | Privacy + UX clarity. |
| D6 | Eval harness is CI-gated on `main`, advisory in PRs. | Speed in PRs, quality on main. |
| D7 | Branch = `feat/ai-adoption` off `main`. No reuse of `refactor/filters`. | User msg 2026-05-13 22:29 |
| D8 | F0 (AI-off contract) ships before any AI feature can land. | ADR-015 enforcement. |
| D9 | Every slice's commit must include the ADR-015 compliance footer. | ADR-015 §"Compliance checklist". |
| D10 | DRY: features call into shared layers (P1–P10). A slice that re-implements a shared layer is BLOCKED in review. | User msg 2026-05-13 22:32 ("don't cut corners") |
| D11 | "State of the art" is judged by: hexagonal port-adapter (P1), tool-use over typed DTOs (P2), SSE streaming (P3), strategy + decorator (P4–P5), compile-time gates (P6), single retrieval API (P7), data-driven eval (P8), single feature registry (P9), interface-based baseline coexistence (P10). | User msg 2026-05-13 22:32 |
| D12 | All AI surfaces are conditionally rendered; never grey-disabled with tooltip. | ADR-015 §I5 |
| D13 | LLM never writes raw SQL. Tool registry is the only mutation surface. | P2 + ADR-015 §I6 |
| D14 | Embedding model defaults per PD3. Configurable. | F1 + F7. |
| D15 | Eval mock provider is deterministic (canned responses keyed by prompt-hash). Live-provider eval is opt-in via `--live` flag. | F6. |

---

## Provisional defaults — flag for owner confirmation before implementation

These are reasonable starting values but were not explicitly
confirmed by the user. The first slice that lands them MUST surface
them in its log under a `=== PROVISIONAL DEFAULTS ===` block and
hold for owner ack before merging:

| # | Subject | Provisional value | Slice |
|---|---|---|---|
| PD1 | Local default model | `llama3.1:8b-instruct-q4_K_M` | F1 / F2 |
| PD2 | Cloud default flavour | OpenAI-compatible API surface (works with OpenAI, vLLM, LiteLLM, Together, Groq, etc.) | F1 / F2 |
| PD3 | Embedding models | local: `nomic-embed-text`; cloud: `text-embedding-3-small` | F7 |
| PD4 | `ai_call_log` retention | 180 days, compressed after 7 | F3 |
| PD5 | `ai_narration_cache` TTL | 30 days for digest; permanent for closed-year YIR | U2 / U3 |
| PD6 | Conversational rate limits | burst 2 / 20 per minute / 200 per day | F9 |
| PD7 | Cost cap default | unset (0 = rate-limit only); 80% banner on threshold | F9 |
| PD8 | Stream stall timeout before cancel | 5 seconds | F5 |

If the owner objects to any default, the change applies in the
single source-of-truth location (registry / config) and propagates
DRY — no per-slice churn.

---

## Mandatory per-slice metadata contribution (DRY enforcement of final-gate coverage)

Every slice that adds an AI feature MUST, as part of its diff:

1. Add or extend the entry in `internal/ai/features/registry.go`
   with **populated** `Routes` metadata (`Backend`, `Frontend`,
   `UITestIDs`, `JobNames`, `PushKinds`). Empty arrays are allowed
   and signal "this surface does not exist for this feature";
   omitted (nil) arrays fail `features.CoverageOK()` and block CI.
2. Add the i18n key for the feature toggle copy.
3. Add at least 3 goldens to `internal/ai/strategies/<feature>/goldens.yaml`.

The 9999 final gate reads the registry directly. No separate
`ai-feature-routes.json` is maintained; manually-curated route maps
were rejected as drift-prone (see "Decision history" below).

---

## Per-slice template (every feature slice MUST include these sections)

In addition to the standard prompt structure (Why · Evidence ·
Design · Tasks · Allowed files · Verification · Deliverable ·
Forward dependency), every feature slice from 0011 onward MUST
include:

### Baseline coexistence (P10)

```
- Baseline impl:        <pkg.TypeName> — what the user sees with AI off
- AI impl:              <pkg.TypeName> — Strategy invocation
- Selection mechanism:  <interface chosen at construction by ai_mode + feature flag>
- Off-mode test:        <test name asserting baseline path is exercised when AI off>
```

For pure-additive panels with no baseline, the "Baseline impl" is
explicitly `null-object that renders nothing` and the off-mode test
asserts the panel is absent — never silently omit this section.

### Redaction policy (F8)

```
- Policy:              <PolicyXxx> from internal/ai/redact/policies.go (named, not inline)
- Allowed classes:     <list, with one-sentence justification each>
- Round-trip required: yes|no  (yes = answers shown to same user contain restored originals)
```

### Off-mode contract impact

```
- Backend routes added:    <list>
- Frontend routes affected:<list>
- New background jobs:     <list>  (each gated by ai_mode at execution)
- New push kinds:          <list>  (suppressed in off mode)
- Service worker chunks:   <ai-* chunk names produced by the build for this feature>
- Client storage keys:     <ai.* keys, if any>
```

A slice missing any of these sections is BLOCKED in review.

---

## Rubber-duck-confirmed risks

### R1 — AI-off CI invariant lulls into false security (HIGH)

The Playwright off-mode walk can pass while a single AI feature
slips through with a different feature flag check. Mitigation:
the registry (P9) is the single source. CI walks the registry and
asserts every feature ID is gated. New AI feature without registry
entry → ESLint+vet failure.

### R2 — Tool-call validation diverges from handler validation (HIGH)

The risk: a tool's JSON schema accepts a payload the underlying
handler later rejects (e.g. tighter Go validation tags). User sees
"AI proposed it, app refused it." Mitigation: tool schemas are
**generated** from the handler DTO struct tags via reflection, not
hand-written. A test asserts every registered tool's schema matches
the live handler validation. Single source of truth = the handler.

### R3 — Local-mode validator is loose (MEDIUM)

"Local-only" allows any RFC1918 host. A user could point Ollama at
a remote server they trust, but a malicious DNS pointing
`localhost.attacker.com` → public IP could leak. Mitigation:
validator resolves the host at config-save time, asserts the
resolved IP is RFC1918 / loopback, AND pins the resolved IP at the
config layer. DNS rebinding is also caught at request time by
re-resolving and comparing.

### R4 — Streaming SSE lacks back-pressure (MEDIUM)

A slow client + a fast model overflows the writer buffer. Mitigation:
`ai.StreamWriter` uses a bounded channel; producer blocks; provider
adapter respects ctx.Done on producer block timeout (5s) and emits
a graceful truncation marker.

### R5 — Embedding store grows unbounded (MEDIUM)

RAG over docs is fine, but RAG over drive/charge events can balloon.
Mitigation: every embedding row carries `source_type` and TTL.
Background worker prunes by `source_type` retention policy. Default
TTL: docs=∞, drives=180d, charges=180d, alerts=90d.

### R6 — LLM-as-judge in eval is non-deterministic (MEDIUM)

Prose-grade goldens fluctuate. Mitigation: judge model is fixed
(opus-class), seeded, and tagged in golden YAML. Drift > 5% triggers
a regression flag. Tool-call goldens stay strict (exact match).

### R7 — Tool-use replay attacks (LOW)

A malicious provider response replays a stored tool call to trigger
an unintended mutation. Mitigation: tool-call IDs are nonces issued
per turn; the dispatcher rejects unknown IDs. The user-confirm step
is per-call, not per-session.

### R8 — Provider downtime degrades feature visibility, not safety (LOW)

When a provider is down, the AI surface shows a clean "AI provider
unavailable" banner and the baseline (heuristic) path is offered as
a one-click fallback. No data loss, no spinner forever.

### R9 — Cost-cap exhaustion mid-conversation is jarring (LOW)

User asking question N+1 gets 429. Mitigation: cap is checked
before request; remaining budget is shown in the AI usage card; a
banner appears at 80%. Mid-stream cost overruns close the stream
gracefully and the partial response is preserved.

### R10 — pgvector HNSW build pauses writes on large embedding tables (LOW)

Online HNSW build is supported by pgvector ≥0.5.0. Mitigation:
F7 verifies the pgvector version at startup and refuses to enable
RAG features if < 0.5.0. The TimescaleDB-HA pg17 image bundles
0.7.x; this is a sanity check.

---

## Slice ordering rationale

```
0000 (this plan)
  └─ 0001 F0 (AI-off contract — type-system invariant)  ← BLOCKING
       │
       ├─ 0002 F1 (provider abstraction)
       │    └─ 0003 F2 (settings UI) ─┐
       │    └─ 0004 F3 (call log)      ├─→ all enable feature slices
       │    └─ 0010 F9 (rate / cost) ──┘
       │
       ├─ 0005 F4 (tool-use framework)
       │    └─ 0006 F5 (SSE streaming)
       │
       ├─ 0007 F6 (eval harness)
       │
       ├─ 0008 F7 (embeddings + pgvector)
       │
       └─ 0009 F8 (redaction)

After foundation:
  U1..U4 in parallel (each requires F0,F1,F4,F5,F6,F8,F9; U2/U3 also need F7)
  N1..N6 in parallel (each requires the same plus F2 settings)
  D1..D5, C1..C5, T1..T3, A1..A3, G1..G3, X1..X2, S1..S7, M1..M3, P1..P3, V1..V2, PU1..PU3, GEN1..GEN2, ML1..ML3
  in any order (independent)

Final:
  9999 (full gate, ADR-015 invariant suite)
```

Each slice produces one commit + one log file. The branch must build
green at every commit so the team can interrupt and ship a partial
phase if priorities change.

---

## Files NOT in scope for this phase (DO NOT touch)

- The Phase-49 alert engine work (latch persistence, cooldown
  unification, smart defaults, escalation tier, multi-select) —
  covered by phase-49 prompts.
- The Phase-50 alert message template restoration (ADR-014) — already
  shipped.
- Telemetry ingestion paths. AI consumes already-stored data; it
  does not change ingestion.
- The signal pipeline / SI canonicalisation work (Phase-42a /
  Phase-48 domain).
- Helm chart structural changes (only adds optional Ollama service
  template, no required infra changes).
- Existing Tesla Fleet API plumbing.

---

## Honesty Covenant (apply to every slice log)

1. Run every verification command. Paste actual output.
2. If a step fails or is skipped, mark `STATUS=BLOCKED` with
   `=== STATUS === EXIT=1 STATUS=BLOCKED`.
3. Include the ADR-015 compliance footer:

   ```
   === AI-OFF CONTRACT ===
   I1 default-off:     PASS|FAIL  (evidence)
   I3 baseline intact: PASS|FAIL  (evidence)
   I4 zero egress:     PASS|FAIL  (evidence)
   I5 hidden UI:       PASS|FAIL  (evidence)
   I6 404 routes:      PASS|FAIL  (evidence)
   I7 per-feature:     PASS|FAIL  (evidence)
   I10 type system:    PASS|FAIL  (evidence)
   =======================
   ```

   Foundation slices (0001–0010) verify only the invariants their
   slice owns; later slices verify all relevant invariants.
4. No "all green" claims without verifiable transcripts.
5. If you find tangential brokenness in another phase's territory,
   log it but DO NOT fix.
6. Note shared-environment artifacts (other agents' edits surfacing
   in `git status`) so reviewers can distinguish them from your own
   work.
7. If a slice references a foundation layer that is incomplete,
   STATUS=BLOCKED with a pointer to the missing slice.

