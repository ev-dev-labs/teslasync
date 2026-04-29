---
applyTo: "internal/api/telemetry*,internal/database/*_repo.go,internal/models/**,internal/worker/**"
---

# Telemetry Data Pipeline Instructions

These rules protect the current Redis + SignalStore + signal_log architecture. They
are non-regression requirements for any telemetry, repository, model, or worker change.

## Current Data Flow

```text
Tesla Fleet Telemetry -> MQTT -> TelemetryHandler
                                  |
                +-----------------+-----------------+
                |                 |                 |
                v                 v                 v
        signal.Store (L1)  RedisSignalCache (L2)   signal_log
        local hot cache    shared live cache        durable history
        FSM/session/merge  SSE fanout/recovery      charts/replay/PIT
```

## Live State Layering - Non-Regression Contract

TeslaSync intentionally keeps both SignalStore and Redis. They are not interchangeable.

| Layer | Role | Allowed reads |
|---|---|---|
| `signal.Store` | Local in-process L1 hot cache | Telemetry merge context, FSM/reconciliation, session logic, alert/template hot path |
| `RedisSignalCache` | Shared L2 live cache | Cross-pod API/current-state reads, restart recovery, SSE fanout |
| `signal_log` | Durable TimescaleDB history | Charts, history, point-in-time reconstruction, drive/charge completion, analytics |

```text
DO NOT read current state from snapshot tables or legacy `positions`.
DO NOT add new endpoints that query snapshot tables for "latest" values.
DO NOT remove SignalStore because Redis exists.
DO NOT route FSM/reconciliation/session hot-path reads through Redis by default.
DO NOT make Redis a synchronous blocker for telemetry ingestion.
DO NOT use Redis as historical truth.
DO NOT claim FSM/reconciliation is active-active across pods without vehicle ownership.

DO update SignalStore first on every telemetry batch.
DO mirror to Redis HSET `vehicle:{vehicleID}:signals` for cross-pod live state.
DO publish `vehicle_update` through Redis channel `vehicle_signals` for multi-pod SSE.
DO use Redis list `signal_log:backlog` only as bounded overflow/crash recovery.
DO use signal_log for history, charts, replay, and point-in-time snapshots.
DO use `LIVE_SIGNAL_STORE_MODE=local` as the rollback switch for Redis-backed live reads.
```

## Scale-Out Topology and Rollback

Phase 35 does not make FSM/reconciliation active-active across API pods. FSM and
reconciliation may run only on the telemetry-owner pod for a vehicle. Until vehicle
ownership/leases or pod affinity exist, production multi-pod deployments must use one
telemetry/FSM owner plus API-only reader pods, or remain single-pod for telemetry/FSM.

`LIVE_SIGNAL_STORE_MODE` is the runtime rollback switch:

| Mode | Behavior |
|---|---|
| `hybrid` | Redis-backed distributed live reads are enabled. |
| `local` | Redis-backed distributed live reads are disabled for rollback; local SignalStore and signal_log still operate. |

## Freshness and SSE Semantics

Cross-pod live reads use a 2-minute freshness threshold. Values older than that are
stale. Legacy scalar Redis values that lack timestamps have unknown freshness and must
not be presented as fresh live data.

Redis Pub/Sub `vehicle_update` SSE fanout is best-effort. It is not durable replay.
Clients must recover missed current state through polling/live reads. Alert when the
`vehicle_update` drop rate is sustained above 0.1% over 5 minutes or Redis subscription
failure lasts more than 60 seconds.

## Signal Processing Rules

### Signal Names

Tesla signals arrive with different names across firmware versions. Normalize through
the existing alias/canonicalization path before adding new per-signal logic.

```go
// Try canonical name first, then alternates.
fl, flOk := signals["TirePressureFrontLeft"]
if !flOk { fl, flOk = signals["TPMS_FL"] }
if !flOk { fl, flOk = signals["TpmsPressureFl"] }
if !flOk { fl, flOk = signals["TpmsFl"] }
```

When adding signal processing:

1. Check Tesla Fleet Telemetry proto for the canonical name.
2. Check `internal/enums/signal_types.go` for the registered type.
3. Check `internal/telemetry/signal_alias.go` for canonical/alternate names.
4. Add alternate names only when needed for known Tesla naming drift.

### Raw Values and Units

Raw telemetry values are stored as received from Tesla. Do not convert values before
writing `signal.Store`, Redis, or `signal_log`. Convert only in derived aggregates,
API projection helpers, or frontend display code.

```go
// Good: keep the raw signal value in all live/history layers.
h.signalStore.Update(vehicleID, signals)
h.redisCache.Update(ctx, vehicleID, signals)
h.signalHistoryWriter.Append(vehicleID, signals)
```

## Ingest Ordering and Failure Behavior

Telemetry ingest is the hot path. Dependency failures must be bounded and visible.

```go
// Required ordering: local L1 first, then bounded side effects.
h.signalStore.Update(vehicleID, signals)

safeGo("redis-signal-cache", func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := h.redisCache.Update(ctx, vehicleID, copySignals(signals)); err != nil {
        log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache update failed")
    }
})
```

Rules:

- SignalStore update must not depend on Redis or Postgres success.
- Redis writes must have bounded context timeouts.
- Redis failures must be logged or surfaced according to the caller contract.
- Redis failure must not erase or corrupt local SignalStore state.
- SSE Redis Pub/Sub must keep a local in-process fallback for single-pod mode.

## Redis Live Signal Contract

Redis live signals use these stable compatibility anchors:

| Purpose | Key/channel |
|---|---|
| Current signal HSET | `vehicle:{vehicleID}:signals` |
| Cross-pod SSE fanout | `vehicle_signals` |
| signal_log overflow backlog | `signal_log:backlog` |

Do not rename these without a compatibility shim, migration note, and tests. Timestamp-less
legacy Redis values must be treated as unknown freshness, not fresh data. Existing scalar
HSET values are supported indefinitely and naturally replaced by timestamped values on
the next telemetry write; no manual Redis migration is required unless scalar compatibility
is explicitly removed by a future ADR.

## signal_log Conventions

Telemetry history is stored in `signal_log`.

```sql
CREATE TABLE signal_log (
  created_at  timestamptz NOT NULL,
  vehicle_id  bigint NOT NULL REFERENCES vehicles(id),
  signal      text NOT NULL,
  value_num   double precision,
  value_str   text,
  value_bool  boolean,
  value_jsonb jsonb,
  PRIMARY KEY (created_at, vehicle_id, signal)
);
```

- Store exactly one typed value column per row.
- Use `ON CONFLICT (created_at, vehicle_id, signal)` for replay/idempotency.
- Use pivot helpers such as `SignalTracePivotFlat` or point-in-time reconstruction.
- Do not resurrect snapshot tables or `vehicle_live_state` for new telemetry.

## Idempotent Writes

Telemetry can be replayed after pod restart or MQTT retry. All durable writes must be
idempotent.

```sql
-- Good: signal_log replay is idempotent.
INSERT INTO signal_log (...) VALUES (...);
ON CONFLICT (created_at, vehicle_id, signal) DO UPDATE SET ...;

-- Bad: duplicate rows on replay.
INSERT INTO signal_log (...) VALUES (...);
```

## Zero/Null Filtering

Some signals arrive as zero, null, or invalid markers when the car is asleep or a
sensor is unavailable.

```go
// Good: skip Tesla invalid markers.
if m, ok := value.(map[string]interface{}); ok {
    if invalid, ok := m["invalid"].(bool); ok && invalid {
        return
    }
}
```

Do not store fabricated zeros for missing measurements. Preserve null/missing state
unless the signal truly reports zero.

## Adding a New Telemetry Signal

Checklist for a new signal, for example `TireTempFrontLeft`:

```text
[ ] 1. Register the signal in internal/enums/signal_types.go.
[ ] 2. Add canonical/alternate aliases in internal/telemetry/signal_alias.go if Tesla names vary.
[ ] 3. Add the signal to fleet-telemetry-config.json subscription list.
[ ] 4. Ensure telemetry_handler.go passes the normalized signal through SignalStore, Redis, and signal_log.
[ ] 5. If used by a derived endpoint, add it to the appropriate pivot/mapping helper.
[ ] 6. If local hot-path logic needs direct SignalStore reads, document why.
[ ] 7. Update web/src/api/types.ts only when an API response shape changes.
[ ] 8. Wire frontend usage with unit conversion, null safety, loading, error, and empty states.
[ ] 9. Add tests for Redis nil/failure behavior if the signal affects live-state reads.
[ ] 10. Do not add snapshot-table or vehicle_live_state columns for new telemetry.
```
