---
description: "Phase 41-rewrite F010 - mqtt subscriber malformed-payload (auto-CLOSED if legacy subscriber deleted)"
---

# Prompt 0150 — F010: MQTT subscriber malformed payload

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F010 (MED, ingest-correctness)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0150-F010-mqtt-malformed-payload.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/mqtt/subscriber.go`, `internal/mqtt/subscriber_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F010)

`internal/mqtt/subscriber.go:133-139` — per-field JSON parse failure
falls through to `value = string(payload)`. Malformed payloads silently
become a string-typed signal, which downstream type checks may then
discard or misinterpret. The legacy subscriber's preferred fix per
F001/phase-42a is wholesale deletion.

## Auto-close clause (PREFLIGHT)

If `cmd/teslasync/main.go` no longer references `mqtt.NewSubscriber`
(only `mqtt.NewPipelineSubscriber`) AND `internal/mqtt/subscriber.go`
either no longer exists OR the cited `value = string(payload)`
fallback at lines 133-139 has already been removed by phase-42a/0090
(legacy-deletion), then this prompt SHORT-CIRCUITS:
- `=== PREFLIGHT ===` records the evidence.
- Status = `CLOSED-BY-PHASE-42A-0090`.
- Write `EXIT=0` + `STATUS=DONE` (with PREFLIGHT note in COMMIT message).
- Skip remaining steps; commit log only.

## Invariant (if NOT auto-closed)

Malformed payloads MUST be surfaced as explicit errors + dropped +
counted, NOT silently coerced into a string-typed signal that flows
downstream as ostensibly valid data.

## Locked Implementation Decisions (if NOT auto-closed)

| # | Decision | Choice |
|---|---|---|
| 1 | Pattern | Replace the silent string fallback with: `log.Warn().Bytes("payload_head", payload[:min(64,len(payload))]).Msg("malformed mqtt payload"); metrics.MalformedPayloadsTotal.Inc(); continue`. |
| 2 | Metric | Use existing metric if available; otherwise add `MalformedPayloadsTotal` to internal/metrics with a `topic` label. |
| 3 | Tests | Table-driven test: malformed payloads (truncated JSON, garbage bytes, wrong field types) increment the metric and produce no signal. Valid payloads still parse. |
| 4 | Build/test gate | `go build ./internal/mqtt/...` + `go test -count=1 ./internal/mqtt/...`. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. AUTO-CLOSE check — if conditions met, log + commit + DONE.
3. Otherwise: `=== AUDIT_EVIDENCE ===` dump L133-139 BEFORE.
4. `=== IMPLEMENTATION ===` — replace silent fallback with explicit error path.
5. `=== GATE ===` — build / vet / test. Anchored grep: `grep -n 'value = string(payload)' internal/mqtt/subscriber.go` returns 0.
6. `=== COMMIT ===` commit accordingly (`fix(mqtt): F010 — surface malformed payloads as errors + metric` OR `chore(phase-41-rewrite/0150): F010 closed by phase-42a/0090 legacy-deletion`).
