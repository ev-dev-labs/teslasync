---
description: "Phase 42a - methodology + cutover decision + ADR-004 amendment"
---

# Prompt 0000 — Methodology + Cutover Decision + ADR-004 Amendment

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0000-methodology-and-cutover-decision.log` |
| Depends on | `phase-42-9999v2-final-gate.log` (must be EXIT=0/STATUS=DONE) |
| Allowed files to change | `.github/ARCHITECTURE.md`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. No red-as-green — EXIT != 0 means STATUS=BLOCKED, no exceptions.
2. No scope narrowing — run the exact gate command, no subsets.
3. No skip-and-assume — cannot run gate means BLOCKED, never DONE.
4. No field resurrection — do not add back deleted fields to "fix" things.
5. No stubs — no `return nil`, `// TODO`, or `panic("not impl")`.
6. No delegation — NO sub-agents, NO parallel, NO background tasks.
7. No predecessor bypass — verify predecessor STATUS=DONE first.
8. No commit on red — commit only the log when BLOCKED.
9. No silent drift — `git status` outside allowed files means BLOCKED.
10. Log MUST contain `EXIT=<int>` and `STATUS=<DONE|BLOCKED>` on their own lines.
11. No dead code retention — when this phase deletes legacy code, the deletion
    is part of the cutover prompt; legacy + new MUST NOT coexist after cutover.
12. No production blind spot — every claim that the pipeline is "wired" MUST
    be backed by a grep against `cmd/teslasync/main.go` showing the new
    constructor and the absence of the old one.
<!-- END COVENANT -->

## Logging Requirements

Write `=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DECISIONS ===`,
`=== REASONING ===`, `=== GATE ===`, and `=== COMMIT ===` to the output log.

## Problem

Phase-42 (60 prompts, gate PASSED) built a forward-only Tesla Fleet Telemetry
pipeline rewrite (per ADR-004): vendored proto + codegen + reflective coverage,
new `internal/tesla/{codec,units,unit_history,bootstrap,config,router,normalize}`
packages, 286-route `routing.yaml`, 12 destinations, new SI-canonical schema
(migrations 000181-000188), and migrated all CONSUMERS (mqtt port, signal
store, signal pivot, signal redis cache, signal state reader, FSM adapter,
FSM domain, API fleet telemetry, API signals, API telemetry handlers,
API SSE, frontend typed envelope, drives core, drives analytics, charging,
positions+trips, cross-domain) to read from the new tables.

**What phase-42 did NOT build:**

1. **Zero production `router.Writer` implementations.** Every consumer was
   migrated to read from `signal_log`, `positions_si`, `*_snapshots_si`,
   `charging_si`, `drives_si`, etc. — but the writers that POPULATE those
   tables were never authored. The 286 routes in `routing.yaml` reference 12
   destinations (positions, climate_snapshot, security_event, motor_snapshot,
   tire_pressure_snapshot, media_snapshot, safety_snapshot, location_snapshot,
   charging_telemetry, drive_telemetry, signal_log, unit_history). Today none
   of them have a writer registered: `router.New(map[Destination]Writer{})`
   would error with `"router: routing.yaml uses destination X for field Y with
   no writer registered"` for the first non-`drop` destination loaded. This is
   verifiable by `grep -r 'router.Writer' internal/ --include='*.go'
   | grep -v _test.go` returning 0 lines.

2. **Side-effect coverage gap.** The legacy `(*TelemetryHandler).ProcessSignals`
   path performs 5 cross-cutting effects per payload that the new
   `normalize.Pipeline` does NOT cover:
   - `liveSignalStore.UpdateAll(vehicleID, signals)` — L1 in-process live state
   - `signalHistoryWriter.Append(vehicleID, signals)` — durable history append
   - `broadcastSSE(payload)` — server-sent events fanout to SPA
   - `fsmHandler.ProcessSignals(ctx, vehicleID, signals)` — drive/charge/sleep FSM
   - `sessionTracker.ProcessSignals(ctx, vehicleID, vin, signals, accum)` — session opens/closes
   - `alertEvaluator.Evaluate(ctx, vehicleID, vin, signals, accum)` — user alerts
   `normalize.Pipeline.Process` strictly does codec → unit_history → router.Route.
   Adding any of the 6 to the pipeline directly violates ADR-004 #2's
   single-responsibility (pipeline is just normalize + dispatch). They must
   live in an Observer/Bridge owned by the subscriber.

3. **No production cutover.** `cmd/teslasync/main.go:476` still constructs
   `ftSubscriber := mqtt.NewSubscriber(...)` (the legacy subscriber).
   `mqtt.NewPipelineSubscriber` exists and is fully tested but is unused in
   any production binary. This is verifiable with
   `grep -n 'NewPipelineSubscriber' cmd/`.

4. **HTTP webhook ingest still legacy.** `(*TelemetryHandler).ProcessBatch`
   at `internal/api/telemetry_handler_ingest.go:489` still calls
   `normalizeFleetUnits` (L512). Phase-42 prompt 0079a refactored the comments
   but not the code path. The HTTP webhook is a second ingest entry alongside
   MQTT — both must go through the pipeline if the "single pipeline"
   invariant from ADR-004 #2 is to hold.

**Frontend impact (phase-43 audit, prompt 0080).** Frontend hook coverage
audit found 9 hooks with broken URLs or orphan status. 6 of them
(`useStateTimeline`, mileage, vampire-drain, guard, signal-catalog,
trip-detail) call endpoints that read from tables phase-42 dropped without
replacement. ADR-004 #4 ("forward-only, no backfill") is being REVERSED in
this prompt: every dropped feature must have a replacement endpoint sourced
from `signal_log` / `fsm_live` / `drives_si` / `trips`. Replacement handlers
are deferred to phase-43a (separate slate), but they cannot be authored
until phase-42a finishes and the SI tables actually receive data.

## Locked Architectural Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Side-effects pattern** | **AtomicsObserver registered with `normalize.New`.** Pipeline calls each registered observer's `OnPayloadProcessed(ctx, vehicleID, atomics)` AFTER the route loop completes for the payload. Observers do their own atomic→map conversion and invoke the legacy callbacks (`UpdateAll`, `Append`, `broadcastSSE`, `FSMHandler.ProcessSignals`, `SessionTracker.ProcessSignals`, `AlertEvaluator.Evaluate`). This preserves the single-public-entry invariant (`Process` remains THE one entry from bytes), keeps the pipeline pure (codec → unit → route + observer-fanout), and lets the subscriber own orchestration. |
| 2 | **Writer organisation** | **One Go file per destination** under `internal/tesla/router/writers/`. Each file exports a `New<Dest>Writer(...)` constructor returning `router.Writer`. Snapshot writers (climate, motor, tire_pressure, media, safety, location, security_event) share an unexported `snapshotWriter` helper for the (vehicle_id, ts, column) upsert pattern; per-destination wrappers only differ in target table name and any per-column transforms. |
| 3 | **DLQ wiring** | Production `*MQTTDLQPublisher` (already exists at `internal/mqtt/mqtt.go:831`) wired in `cmd/teslasync` with paho client constructed via `SetAutoAckDisabled(true)`. ack-on-success / nack-and-DLQ on `errors.Is(err, normalize.ErrPayloadDrop)`. All other per-atomic failures are swallowed (logged + counted via `tesla_router_writer_failures_total`) and the message is acked normally per ADR-004 #8. |
| 4 | **Cutover discipline** | Hard cutover, no feature flag, no parallel pipeline. The cutover prompt deletes the legacy `ftSubscriber := mqtt.NewSubscriber(...)` and replaces it with `ftSubscriber := mqtt.NewPipelineSubscriber(...)` in the same diff. No `if newPipelineEnabled` switch. The deletion + replacement is one atomic prompt. |
| 5 | **HTTP webhook unification** | `(*TelemetryHandler).ProcessBatch` is rewritten to call `pipeline.Process` with the raw payload bytes; `normalizeFleetUnits` is deleted from `telemetry_handler_ingest.go` in the same prompt. Both MQTT and HTTP webhook ingest paths terminate at `pipeline.Process`. |
| 6 | **Legacy code deletion** | After cutover, the following are deleted in prompt 0090: legacy `mqtt.Subscriber` (the non-Pipeline variant), `(*TelemetryHandler).ProcessSignals` (the legacy entry — the side-effect callbacks themselves stay; only the legacy entry is deleted), `normalizeFleetUnits`, `flattenCompoundMapValue`, and any remaining `internal/telemetry/*` shims. The reflective `TestSinglePipelineInvariant` already enforces this; the deletion makes it visibly true. |
| 7 | **No-UI-deletion (ADR-004 #4 reversal)** | ADR-004 #4 ("None — start fresh on deploy") is amended: dropped backend features that had a frontend consumer MUST have a replacement endpoint sourced from the new SI schema. Replacement endpoints are scoped to phase-43a (separate slate) and are NOT in scope for phase-42a. Phase-42a's job is to make data flow through the pipeline so phase-43a's handlers have something to query. |
| 8 | **Observer test fakes vs production observers** | The single production observer is `tesla_pipeline.SideEffectsObserver` constructed with the existing 5 callbacks (live store, signal history, SSE, FSM, sessions+alerts). Test observers (recording fakes for unit tests) live in `_test.go` files only. A reflective test in the e2e prompt walks the production binary's pipeline construction site and asserts a non-empty observer list. |

## Action Steps

1. Verify `git status` is clean before starting (only the log file should be touched).
2. Verify predecessor: `phase-42-9999v2-final-gate.log` exists with EXIT=0/STATUS=DONE. If not, BLOCK.
3. In `=== PREFLIGHT ===`, capture:
   - `git rev-parse HEAD`
   - `git status --short`
   - `Test-Path .github\prompts\db-refactor\logs\phase-42-9999v2-final-gate.log`
   - First 5 lines and last 5 lines of `phase-42-9999v2-final-gate.log`
4. In `=== AUDIT_EVIDENCE ===`, capture (these are the gating proofs that
   the gap is real — if any of them returns the OPPOSITE result, BLOCK and
   demand re-audit):
   - `grep -rn 'router\.Writer' internal/ --include='*.go' | grep -v _test.go`
     MUST return 0 lines (no production writers exist).
   - `grep -n 'NewPipelineSubscriber' cmd/teslasync/main.go`
     MUST return 0 lines (no production cutover yet).
   - `grep -n 'normalizeFleetUnits' internal/api/telemetry_handler_ingest.go`
     MUST return >= 1 line (legacy normalization still in HTTP webhook).
   - Count of routes in `internal/tesla/router/routing.yaml`:
     `Select-String -Path internal\tesla\router\routing.yaml -Pattern '^\s*-\s*field:' | Measure-Object | %{ $_.Count }`
     MUST be 286.
   - Count of distinct destinations:
     `(Select-String -Path internal\tesla\router\routing.yaml -Pattern 'dest:\s*(\w+)' -AllMatches | %{ $_.Matches } | %{ $_.Groups[1].Value } | Sort-Object -Unique | Measure-Object).Count`
     MUST be 12.
5. In `=== DECISIONS ===`, restate decisions 1-8 verbatim from this prompt.
6. In `=== REASONING ===`, document explicitly:
   - Why the AtomicsObserver pattern was chosen over (a) extending Pipeline
     with side-effect knowledge, (b) moving side effects into writers,
     (c) re-decoding bytes in the subscriber. Include the trade-off matrix.
   - Why the cutover is hard (no flag) instead of flagged. Cite Decision #4.
   - Why ADR-004 #4 is being reversed (no-UI-deletion rule from user).
   - Why phase-43a is sequenced after phase-42a (data flow dependency).
7. Amend `.github/ARCHITECTURE.md`:
   - Append a "Phase-42a Amendment" section under ADR-004.
   - Reverse ADR-004 #4. Old text becomes a strikethrough block; new text
     reads: "Backfill is NOT performed, but every dropped backend feature
     that had a frontend consumer MUST have a replacement endpoint sourced
     from the new SI schema. Replacement endpoints are tracked in phase-43a."
   - Add ADR-004 #11: "AtomicsObserver pattern. Pipeline.New accepts a
     variadic list of AtomicsObserver. Pipeline.Process invokes each observer
     after the route loop completes. Observers own their atomic→map
     conversion and invoke side-effect callbacks. Observers MUST NOT mutate
     the atomics slice."
   - Add ADR-004 #12: "Single ingest cutover. cmd/teslasync constructs
     exactly one MQTT subscriber: mqtt.NewPipelineSubscriber. The legacy
     mqtt.NewSubscriber is deleted in the cutover prompt. The HTTP webhook
     entry (TelemetryHandler.ProcessBatch) calls pipeline.Process directly
     on raw bytes; normalizeFleetUnits is deleted."
8. In `=== GATE ===`, run:
   - `git status --short -- .github/ARCHITECTURE.md` MUST show 1 modified file.
   - `git diff --stat` MUST show only the ADR file changed.
   - `Select-String -Path .github\ARCHITECTURE.md -Pattern '^### Phase-42a Amendment'`
     MUST return >= 1 match.
   - `Select-String -Path .github\ARCHITECTURE.md -Pattern 'AtomicsObserver pattern'`
     MUST return >= 1 match.
9. In `=== COMMIT ===`, commit `.github/ARCHITECTURE.md` + the log with
   message: `docs(adr): phase-42a — amend ADR-004 (#4 reversed, +#11, +#12)`
   Trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
10. Append `EXIT=0` and `STATUS=DONE` on their own lines to the log.

## What this prompt does NOT do

- Author writers (deferred to 0010-0023).
- Author observer (deferred to 0030).
- Wire DLQ + manual-ack (deferred to 0040).
- Cut over (deferred to 0050).
- Refactor HTTP webhook (deferred to 0060).
- Delete legacy code (deferred to 0090).
- Author phase-43a (separate slate).

## Escape hatch

If the AUDIT_EVIDENCE checks return UNEXPECTED results (e.g., a writer DOES
exist that grep missed, or the cutover ALREADY happened in a commit between
phase-42 close and now), STOP, log the discrepancy verbatim under
`=== AUDIT_EVIDENCE ===`, mark STATUS=BLOCKED, commit nothing, and surface
the discrepancy to the user. Do NOT silently absorb the divergence —
phase-42a's entire scope depends on these starting conditions being true.
