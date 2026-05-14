---
description: "Phase-50 / Prompt 0004 — F3: AI Call Log + Usage Card"
---

# Phase-50 / Prompt 0004 — F3: AI Call Log + Usage Card

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0004-F3-ai-call-log.log |
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

> **Depends on:** F0, F1, F2
> **Pattern:** P5 decorator chain (Audit decorator)

## Why

Without a per-call audit log, AI cost, latency, and content cannot be
investigated, capped, or evaluated. This slice mirrors the
established `TeslaApiUsageCard` pattern and gives users + admins a
ground-truth view of every AI call the system made on their behalf.

## Design

### D4.1 Schema

Migration `000198_ai_call_log.up.sql`:

```sql
CREATE TABLE ai_call_log (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_id      TEXT        NOT NULL,                    -- registry ID, validated by app
    provider        TEXT        NOT NULL,                    -- ollama|openai|anthropic|mock
    model           TEXT        NOT NULL,
    input_tokens    INTEGER     NOT NULL DEFAULT 0,
    output_tokens   INTEGER     NOT NULL DEFAULT 0,
    cost_micro_cents BIGINT     NOT NULL DEFAULT 0,         -- 1 cent = 10000
    latency_ms      INTEGER     NOT NULL DEFAULT 0,
    finish_reason   TEXT        NOT NULL DEFAULT '',
    request_hash    TEXT        NOT NULL,                    -- sha256 of (model||messages)
    redacted_digest TEXT        NOT NULL,                    -- sha256 of redacted prompt for repro
    error           TEXT        NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT create_hypertable('ai_call_log','started_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE);

CREATE INDEX ai_call_log_user_started_idx ON ai_call_log (user_id, started_at DESC);
CREATE INDEX ai_call_log_feature_idx       ON ai_call_log (feature_id, started_at DESC);

-- Retention: 180 days, compressed after 7
ALTER TABLE ai_call_log SET (timescaledb.compress, timescaledb.compress_segmentby = 'user_id');
SELECT add_compression_policy('ai_call_log', INTERVAL '7 days');
SELECT add_retention_policy ('ai_call_log', INTERVAL '180 days');

COMMENT ON TABLE ai_call_log IS 'Per-call audit log for AI provider calls. Empty when ai_mode=off (ADR-015 I4).';
COMMENT ON COLUMN ai_call_log.redacted_digest IS 'sha256 of the post-redaction prompt; lets us reproduce a bug report without storing PII.';
```

### D4.2 Cost calculator

`internal/ai/cost/cost.go` — table of `{provider, model, input_per_million, output_per_million}` rates. Returns `cost_micro_cents` for a (provider, model, in, out) tuple. Local providers (Ollama) → 0. Auditable. Updated via `make ai-prices` from a versioned JSON file.

### D4.3 Audit decorator

`internal/ai/provider/audit.go` — implements `Decorator`. Wraps every
provider call with `started_at`, captures usage, writes row, propagates
error. Stays out of the request hot path: write is async via a
buffered channel + drainer goroutine; full buffer drops oldest with
a metric `ai_call_log_drop_total`.

### D4.4 Usage queries + handler

`internal/database/ai_call_log_repo.go`:
- `Today(userID) → AggregateRow{in,out,cost,calls}`
- `ByFeature(userID, since) → []FeatureRow`
- `Recent(userID, limit) → []CallRow`

`internal/api/ai_usage_handler.go` — three GETs guarded by F0
(registered against feature ID `__usage__` which is special-cased to
require `ai_mode != 'off'` only, no per-feature toggle).

### D4.5 Frontend usage card

`web/src/features/system/components/status/AiUsageCard.tsx` — mirrors
`TeslaApiUsageCard.tsx` exactly. Same chart components, same layout,
same i18n key conventions. **DRY**: extract the shared visual into
`UsageCard` in `components/data-display` so both Tesla API + AI
share it.

`web/src/api/hooks/useAiUsage.ts` — three queries.

### D4.6 Off-mode

When `ai_mode='off'`:
- Audit decorator is not in the chain (since no calls happen).
- `ai_call_log` table exists but stays empty.
- `AiUsageCard` is wrapped in `withAiFeature("__usage__")` and
  returns null → not rendered.

## Tasks

1. Migration up/down with hypertable + compression + retention.
2. Cost calculator + price table + tests for each known model.
3. Audit decorator + tests with mock provider.
4. Repo with three queries + tests.
5. Handler + tests.
6. Refactor `TeslaApiUsageCard` to share the visual via new
   `UsageCard` component (DRY win).
7. Build `AiUsageCard` consuming the shared component.
8. Wire decorator into `app.New()` chain.
9. Register `__usage__` in the registry (special-case marked).

## Allowed files

- `migrations/000198_ai_call_log.up.sql`, `.down.sql`
- `internal/ai/cost/**` (new package)
- `internal/ai/provider/audit.go` (+ test)
- `internal/database/ai_call_log_repo.go` (+ test)
- `internal/api/ai_usage_handler.go` (+ test)
- `internal/api/router.go` (3 routes)
- `internal/app/new.go` (decorator wiring)
- `web/src/components/data-display/UsageCard.tsx` (new shared)
- `web/src/components/data-display/__tests__/UsageCard.test.tsx`
- `web/src/features/system/components/status/AiUsageCard.tsx` (+ test)
- `web/src/features/system/components/status/TeslaApiUsageCard.tsx`
  (refactor to consume `UsageCard`)
- `web/src/api/hooks/useAiUsage.ts` (+ test)
- `internal/ai/features/registry.go` (add `__usage__`)

## Verification

```
goose up
go test -race ./internal/ai/...
go test -race ./internal/database/... -run AiCallLog
cd web && npx tsc --noEmit && npm test -- --run UsageCard AiUsageCard

# Manual
# - mode=off, exercise pages → SELECT count(*) FROM ai_call_log → 0
# - mode=local + chatbot toggle on, send chat → row appears with model, tokens, latency
# - retention policy listed in TimescaleDB job table
```

## Deliverable

Log includes ADR-015 compliance footer (I4 PASS via SQL count check).

## Forward dependency

Every later slice that calls a provider gets audited automatically
because the decorator is in the chain — no per-feature work required.

