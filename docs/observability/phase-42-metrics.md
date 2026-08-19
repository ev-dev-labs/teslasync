# Phase-42 Tesla Pipeline Metrics

> **Source:** Phase-42 Fleet Telemetry pipeline rewrite (ADR-004).
> **Audience:** Operators wiring Grafana dashboards / Alertmanager rules.
> **Last verified:** 2026-05-05 against `refactor/signals-rewrite` HEAD.

This is the canonical catalog of Prometheus metrics emitted by the Phase-42
Tesla pipeline. Every metric below is grep-verifiable in the cited Go file
and uses the `tesla_` namespace (no other subsystem in TeslaSync uses it).

If you add a new metric to `internal/tesla/**`, `internal/signal/**`,
`internal/mqtt/mqtt.go`, or `internal/worker/unit_drift_validator.go`, add it
here in the same PR — operator dashboards depend on this catalog being
exhaustive.

## Quick reference

| # | Metric | Type | Labels | Owner |
|---|---|---|---|---|
| 1 | `tesla_normalize_unit_context_missing_total` | counter | `field` | `internal/tesla/normalize` |
| 2 | `tesla_normalize_values_processed_total` | counter | `field`, `outcome` | `internal/tesla/normalize` |
| 3 | `tesla_bootstrap_skipped_total` | counter | `vehicle_id`, `reason` | `internal/tesla/bootstrap` |
| 4 | `tesla_signal_cache_stale_total` | counter | `vehicle_id`, `field` | `internal/signal` |
| 5 | `tesla_unit_drift_suspected_total` | counter | `vehicle_id`, `kind` | `internal/worker` |
| 6 | `tesla_unit_history_canary_total` | counter | `vehicle_id`, `reason` | `internal/worker` |
| 7 | `tesla_unit_history_invalidate_failures_total` | counter | `reason` | `internal/tesla/unit_history` |
| 8 | `tesla_router_writer_failures_total` | counter | `dest`, `reason` | `internal/tesla/router` |
| 9 | `tesla_router_no_route_total` | counter | `field` | `internal/tesla/router` |
| 10 | `tesla_mqtt_dlq_writes_total` | counter | `reason` | `internal/mqtt` |
| 11 | `tesla_mqtt_normalize_failures_total` | counter | `reason` | `internal/mqtt` |
| 12 | `tesla_mqtt_dlq_publishes_total` | counter | `outcome` | `internal/mqtt` |

---

## Detailed reference

### 1. `tesla_normalize_unit_context_missing_total`

- **Source:** `internal/tesla/normalize/normalize.go` (`UnitContextMissing` field)
- **Labels:** `field` — canonical proto field name
- **Meaning:** Atomic values dropped because `vehicle_unit_history` had no row
  for the field's `UnitKind` at the atomic's `EmittedAt`. A non-zero rate
  indicates the bootstrap layer (or live `Setting*Unit` emission) has not yet
  seeded unit context for the vehicle.
- **Why it matters:** This is the Phase-42 anti-corruption guardrail
  (ADR-004 #9e). Every increment is a sample we deliberately dropped rather
  than risk silent unit corruption. A sustained non-zero rate means a vehicle
  has been emitting unit-bearing values for >5min without a unit-history row.
- **Suggested alert:**
  ```
  rate(tesla_normalize_unit_context_missing_total[5m]) > 0
    for: 5m
    severity: warning
  ```

### 2. `tesla_normalize_values_processed_total`

- **Source:** `internal/tesla/normalize/normalize.go` (`ValuesProcessed` field)
- **Labels:** `field`, `outcome` — outcome ∈ `{ok, dropped_no_unit,
  dropped_invalid, dropped_no_route, error}`
- **Meaning:** Every atomic the dispatch loop touches, bucketed by outcome.
  This is the overall pipeline traffic gauge.
- **Use:** Compute the dropped/processed ratio per field to spot fields that
  are routinely failing conversion. A spike in `outcome="error"` means the
  dispatcher itself is panicking.

### 3. `tesla_bootstrap_skipped_total`

- **Source:** `internal/tesla/bootstrap/types.go` (`Skipped` field)
- **Labels:** `vehicle_id`, `reason` — closed reason set: `vehicle_asleep`,
  `rest_unauthorized`, `rest_rate_limited`, `rest_unreachable`, `unknown_error`
- **Meaning:** Bootstrap `Seed` calls that exhausted retries and returned nil.
  Affected vehicles will drop telemetry until live `Setting*Unit` signals
  seed `vehicle_unit_history`.
- **Why it matters:** Bootstrap is the belt to telemetry's suspenders
  (ADR-004 #9d). When bootstrap fails AND a vehicle's `Setting*Unit` is
  silent, we drop every unit-bearing sample.
- **Suggested alert:**
  ```
  rate(tesla_bootstrap_skipped_total{reason!="vehicle_asleep"}[15m]) > 0.1
    for: 15m
    severity: warning
  ```

### 4. `tesla_signal_cache_stale_total`

- **Source:** `internal/signal/redis_cache.go` (`StaleReads` field)
- **Labels:** `vehicle_id`, `field`
- **Meaning:** Stale entries returned by the freshness-aware Redis signal
  cache reads (the `*Fresh` API). A non-zero rate indicates that cross-pod
  live-state reads are being served from a stale cache row — the producer
  pod has not pushed an update within the freshness window.
- **Use:** Diagnose "the dashboard is showing data from 10 minutes ago"
  reports. If this metric is non-zero for a vehicle, the producer pod owning
  that vehicle has either died or stopped receiving telemetry.

### 5. `tesla_unit_drift_suspected_total`

- **Source:** `internal/worker/unit_drift_validator.go` (`Suspected` field)
- **Labels:** `vehicle_id`, `kind` — closed kind set: `speed`, `odometer`,
  `temperature`, `pressure`
- **Meaning:** Findings from the nightly unit-drift validator that suggest
  silent unit corruption. The validator cross-checks values against
  independent ground truth (e.g., speed vs Location-implied speed, odometer
  trip delta vs integrated speed integral).
- **Why it matters:** This is the explicit phase-42 detection net for the
  unit corruption class that Phase-42 was authored to eliminate
  (ADR-004 #9). Any non-zero value is an incident.
- **Suggested alert:**
  ```
  increase(tesla_unit_drift_suspected_total[24h]) > 0
    severity: critical
  ```

### 6. `tesla_unit_history_canary_total`

- **Source:** `internal/worker/unit_drift_validator.go` (`Canary` field)
- **Labels:** `vehicle_id`, `reason` — closed set: `no_history_7d`
- **Meaning:** Validator's `vehicle_unit_history` sanity check. `no_history_7d`
  fires when a vehicle has no `vehicle_unit_history` rows in the past 7 days
  — i.e., `Setting*Unit` signals are not reaching the pipeline.
- **Use:** Pre-warning before #1 starts firing. A vehicle hitting this
  canary is one bootstrap failure away from dropping telemetry.

### 7. `tesla_unit_history_invalidate_failures_total`

- **Source:** `internal/tesla/unit_history/types.go` (`InvalidateFailures` field)
- **Labels:** `reason` — closed set: `redis_del`
- **Meaning:** Cache-invalidation failures during `Repo.Record`.
  `redis_del`: Redis unreachable; pods may read stale unit for up to TTL (60s).
- **Why it matters:** A stale unit cache means a vehicle that just toggled
  miles → km might be converted using the old unit for up to one cache TTL
  window, producing a brief burst of corruption. Also drives #1 / #5 if it
  persists longer than the TTL.

### 8. `tesla_router_writer_failures_total`

- **Source:** `internal/tesla/router/router.go` (`WriterFailures` field)
- **Labels:** `dest` (closed set from `routing.Destination`), `reason` —
  closed set: `timeout`, `canceled`, `other`
- **Meaning:** Router `writer.Write` calls that returned an error. Per
  ADR-004 #8, writer failures are logged + counted but NEVER propagated to
  MQTT redelivery — only codec failures (malformed bytes) trigger redelivery.
- **Why it matters:** This metric isolates the persistence boundary. A spike
  on a single `dest` indicates a stuck downstream (DB, Redis, etc.) without
  blocking ingest.

### 9. `tesla_router_no_route_total`

- **Source:** `internal/tesla/router/router.go` (`NoRoute` field)
- **Labels:** `field`
- **Meaning:** Atomic values dropped because their `Field` has no entry in
  `routing.yaml`. A non-zero rate indicates `protomodel`/`routing` drift —
  the labelled `Field` needs to be added to `routing.yaml`.
- **Why it matters:** This is the canary for a Tesla proto upgrade that
  added new fields without an accompanying routing update. The reflective
  coverage test (Prompt 0048) catches this at build time, but production
  catches it here for runtime drift.

### 10. `tesla_mqtt_dlq_writes_total`

- **Source:** `internal/mqtt/mqtt.go` (`DLQWrites` field)
- **Labels:** `reason` — closed set: `codec_drop`, `vin_resolver_error`,
  `other`, `dlq_publish_failure`
- **Meaning:** MQTT payloads quarantined to the DLQ after a terminal ingest
  failure. The subscriber makes one bounded DLQ publish attempt and then ACKs
  the original QoS 1 delivery; MQTT 3.1.1 has no live NACK, so retaining an
  unacknowledged poison payload would eventually exhaust the broker's in-flight
  receive window.
- **Why it matters:** Every increment is a payload Tesla sent us that we
  could not process. A spike in `codec_drop` means either (a) the codec has a
  bug for some Tesla field, or (b) the proto needs to be re-vendored; other
  labels identify resolver or unexpected pipeline failures.
- **Suggested alert:** PAGE on `rate() > 0` (per the inline `mqtt.go`
  governance comment).

### 11. `tesla_mqtt_normalize_failures_total`

- **Source:** `internal/mqtt/mqtt.go` (`NormalizeFailures` field)
- **Labels:** `reason` — closed set: `codec_drop`, `context_canceled`,
  `vin_unknown`, `vin_resolver_error`, `other`
- **Meaning:** `Pipeline.Process` errors observed by the MQTT subscriber,
  before the redelivery / DLQ decision. `codec_drop` is the only reason
  that drives redelivery; everything else is logged + counted only.
- **Use:** Distinguish "Tesla is sending us garbage" (`codec_drop`) from
  "our resolver is misconfigured" (`vin_unknown`, `vin_resolver_error`).

### 12. `tesla_mqtt_dlq_publishes_total`

- **Source:** `internal/mqtt/mqtt.go` (`DLQPublishes` field)
- **Labels:** `outcome` — `ok` | `error`
- **Meaning:** DLQ publish attempts. `outcome="error"` means the broker is
  rejecting our DLQ writes — the poison-pill loop is now dropping data on
  the floor.
- **Suggested alert:** PAGE on `rate(tesla_mqtt_dlq_publishes_total{outcome="error"}[5m]) > 0`.

---

## Operator runbook

When any of these metrics fire, the diagnostic chain is:

1. **`tesla_unit_drift_suspected_total > 0`** — silent corruption detected.
   Stop. Tag the vehicle, snapshot `vehicle_unit_history` rows, then trace
   back through #1 + #6 + #3 to find which seeding layer failed.
2. **`tesla_normalize_unit_context_missing_total > 0` (#1) sustained** — a
   bootstrap or live-`Setting*Unit` gap. Run `cmd/resubscribe` for the
   affected vehicle to force a fresh subscription + bootstrap snapshot.
3. **`tesla_bootstrap_skipped_total{reason="rest_unauthorized"} > 0` (#3)**
   — Tesla credentials are rejected. Rotate `TESLA_CLIENT_SECRET` or
   re-run the OAuth flow.
4. **`tesla_router_no_route_total > 0` (#9)** — Tesla added a field. Re-run
   `go generate ./internal/tesla/protomodel/...` and add a routing entry
   for the labelled field.
5. **`tesla_mqtt_dlq_writes_total > 0` (#10)** — codec failure. Pull the
   DLQ payload, decode manually, and either patch the codec or extend
   `routing.yaml`.

## Cross-references

- **ADR-004:** `.github/ARCHITECTURE.md` — locked architectural decisions.
- **Pipeline contract:** `internal/tesla/normalize/pipeline.go` — single
  ingest entry per ADR-004 #2.
- **Reflective coverage:** `internal/tesla/protomodel/coverage_test.go` —
  build-time guarantee that every proto field has a routing entry.
- **Resubscribe runbook:** `cmd/resubscribe/main.go` — operator-only.
- **Drift validator:** `cmd/unit-drift-validator/main.go` — operator-only.
