---
description: "Phase-50 / Prompt 0010 — F9: Rate Limiter + Cost Cap"
---

# Phase-50 / Prompt 0010 — F9: Rate Limiter + Cost Cap

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | `.github/prompts/db-refactor/logs/phase-50-0010-F9-rate-limiter-cost-cap.log` |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no `return nil`, `// TODO`, `panic("not impl")`
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - `git status` outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| `=== PREFLIGHT ===` | Branch, predecessor logs, and dirty-tree check. |
| `=== SURVEY ===` | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| `=== REASONING ===` | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| `=== CHANGES ===` | Summary of production, test, registry, i18n, prompt, and golden changes. |
| `=== GATE ===` | Full command transcripts with EXIT markers. |
| `=== COMMIT ===` | git add/commit transcript, or blocked-log-only commit transcript. |
| `=== AI-OFF CONTRACT ===` | ADR-015 footer with evidence for every invariant this slice touches. |
| `=== STATUS ===` | Final `EXIT=<int>` and `STATUS=<DONE|BLOCKED>` markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in `=== PREFLIGHT ===`.
3. Survey the current code and document the baseline in `=== SURVEY ===` before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into `=== GATE ===`.
6. If any gate fails, stop with `STATUS=BLOCKED` and commit only the log.

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains `EXIT=0` and `STATUS=DONE` on their own lines, the ADR-015 footer is present with evidence, and `git status --short` contains only allowed files before commit.

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

> **Depends on:** F0, F1, F3
> **Pattern:** P5 (RateLimit + CostCap decorators), R8 (graceful fallback), R9 (cost cap with banner)

## Why

Cloud providers bill per token. Local providers consume CPU/RAM and
can starve the host. Without a rate limiter and a cost cap, a runaway
loop or a user typing fast can exhaust the daily budget or pin the
GPU. Per ADR-015, when AI is exhausted the **baseline must remain
functional** — exhaustion never breaks the app.

## Design

### D10.1 Rate limiter (token bucket per (user, feature))

`internal/ai/limit/limiter.go`:

```go
type Limiter struct {
    buckets sync.Map           // key=(user,feature) → *bucket
    cfg     map[string]Quota   // per-feature quotas
}

type Quota struct {
    BurstReq    int     // max concurrent requests
    PerMinute   int     // requests per minute
    PerDay      int     // requests per day
    InTokensPM  int     // input tokens per minute
    OutTokensPM int     // output tokens per minute
}

func (l *Limiter) Allow(userID int64, featureID string) (Decision, error)

type Decision struct {
    Allowed     bool
    Reason      string  // "burst"|"per_minute"|"per_day"|"input_tokens"|"output_tokens"|"cost_cap"
    RetryAfter  time.Duration
    BannerLevel string  // ""|"warn"|"critical"
}
```

Defaults (per feature; overridable in settings):

| Feature class | BurstReq | PerMinute | PerDay |
|---|---|---|---|
| Conversational (U/N) | 2 | 20 | 200 |
| Generative one-shot (S/GEN) | 1 | 5  | 30  |
| Background (M/digest)        | 1 | 1  | 10  |

### D10.2 Cost cap

`internal/ai/limit/cost.go`:

```go
type CostCap struct {
    repo  CostRepo            // queries today's sum from ai_call_log
    cache *lru.Cache[int64, costSnapshot]
}

func (c *CostCap) Check(userID int64, model string, estimatedIn, estimatedOut int) (Decision, error)
```

Check workflow (R9 mitigation):
1. Read user `ai_cost_cap_cents` from settings (0 = unset).
2. Pull today's spend from `ai_call_log` (cached 30s).
3. Estimate this call's cost via F3's price table.
4. If `today + estimate > cap`: return `Decision{Allowed:false, Reason:"cost_cap"}`.
5. If `today + estimate > 0.8 * cap`: emit `BannerLevel:"warn"`.

### D10.3 Decorator wrappers

`internal/ai/provider/ratelimit_decorator.go` + `cost_decorator.go`
sit in the chain order: Trace → Audit → CostCap → RateLimit →
Redaction → base.

Why CostCap before RateLimit? CostCap is the cheaper check (LRU
hit), and a cost-cap reject doesn't consume rate-limit budget.

### D10.4 Decision propagation (R8)

When a Decorator returns `Allowed:false`:
- Provider returns a typed `*LimitError` with the Decision.
- Dispatcher catches it, emits SSE event:
  ```
  event: error
  data: {"reason":"cost_cap","retry_after_s":3600,"baseline_available":true}
  ```
- Frontend hook surfaces a banner: "AI features rate-limited. Using
  baseline mode for now." with a "Retry" button if retry_after
  passes.

### D10.5 Settings UI surface (extends F2)

Add to `AISettings.tsx`:
- Daily cost cap input (cloud only).
- Live "today" spend bar with 80% warn color.
- Per-feature quotas as a collapsible advanced panel (default
  values shown read-only; admin can override).

### D10.6 Off / unavailable behaviour

- mode='off': Limiter+CostCap not wired. (Same as F1.)
- Provider unreachable: dispatcher synthesizes
  `Decision{Reason:"provider_unavailable"}` and the same SSE error
  flows. Frontend shows the same banner.
- Local provider OOM (tracked by Ollama health endpoint poll):
  rate-limiter sets `BurstReq=0` for 60s.

## Tasks

1. Limiter + tests (token bucket, sliding window).
2. CostCap + cache + tests.
3. Two decorators + chain wiring.
4. Typed `LimitError` + dispatcher integration.
5. SSE error event surface + frontend banner component
   `AiLimitBanner.tsx`.
6. Settings UI surface (cost cap + spend bar).
7. Per-feature quotas in registry (extend F0).
8. Provider-health poller for Ollama OOM detection.

## Allowed files

- `internal/ai/limit/**`
- `internal/ai/provider/{ratelimit,cost}_decorator.go` (+ tests)
- `internal/ai/dispatch/dispatch.go` (catch LimitError)
- `internal/ai/stream/writer.go` (error event shape)
- `web/src/components/ai/AiLimitBanner.tsx` (+ test)
- `web/src/hooks/useAiStream.ts` (surface limit reason)
- `web/src/features/settings/components/AISettings.tsx` (cap UI)
- `internal/ai/health/ollama_poll.go` (+ test)

## Verification

```
go test -race ./internal/ai/limit/... ./internal/ai/provider/...
cd web && npm test -- --run AiLimitBanner

# Soak test:
# - Set burst=2, spam 10 requests → 8 get 429-style error
# - Set cost cap $0.001 → second call rejected with cost_cap
```

## Deliverable

Log + ADR-015 footer (I3: app remains functional under exhaustion).

## Forward dependency

All conversational + generative features inherit limits automatically.

