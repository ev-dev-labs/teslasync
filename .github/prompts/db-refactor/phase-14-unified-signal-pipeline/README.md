# Phase 14 — Unified Signal Pipeline (PA Architecture)

## Goal

Replace the fragmented signal storage (12+ snapshot/telemetry tables with separate
writers, repos, and handlers) with a single `signal_log` hypertable + Redis HSET.
Clean break — no legacy tables, no data migration, fresh start.

## Architecture

```
Tesla Fleet API → MQTT Broker
                      │
                      ▼
              Signal Ingestion (stateless)
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     Redis HSET   signal_log   Redis Pub/Sub
     (hot cache)  (hypertable)  (→ SSE)
          │           │
          │           ├── Continuous aggregates (dashboard reads)
          │           └── SnapshotAt queries (session completion)
          │
          └── Live dashboard / FSM / API reads
```

## What gets DROPPED (12 tables + their code)

| Table | Repo File | Writer/Handler |
|---|---|---|
| `motor_snapshots` | `motor_repo.go` | `hot_catalog_motor.go` |
| `climate_snapshots` | `climate_repo.go` | `hot_catalog_climate.go` |
| `location_snapshots` | `location_snapshot_repo.go` | telemetry_handler dispatch |
| `battery_snapshots` | — | telemetry_handler dispatch |
| `vehicle_meta_snapshots` | `vehicle_meta_repo.go` | telemetry_handler dispatch |
| `vehicle_live_state` | `live_state_repo.go`, `vehicle_live_state_repo.go` | `store.go` FlushLoop |
| `charging_telemetry` | `charging_telemetry_repo.go` | telemetry_handler dispatch |
| `charge_telemetry_readings` | `charge_telemetry_repo.go` | telemetry_handler dispatch |
| `drive_telemetry_readings` | `drive_telemetry_repo.go` | telemetry_handler dispatch |
| `user_preference_snapshots` | `user_preference_repo.go` | telemetry_handler dispatch |
| `safety_snapshots` (if exists) | `safety_repo.go` | telemetry_handler dispatch |
| `tire_pressure_snapshots` (if exists) | `tire_pressure_repo.go` | telemetry_handler dispatch |

## What STAYS

| Table | Purpose |
|---|---|
| `signal_log` (was `signal_history`) | THE source of truth — all signals, all time |
| `drives` | Slim: start_ts, end_ts, computed fields from signal_log |
| `charging_sessions` | Slim: start_ts, end_ts, computed fields from signal_log |
| `vehicle_states` | FSM transition log |
| `vehicles`, `vehicle_units` | Vehicle metadata |
| `settings`, `geofences`, `automations`, `notifications`, etc. | User config |
| `positions` | Kept as materialized from signal_log (lat/lng/speed/heading per timestamp) |
| `fsm_transitions` | FSM audit log |

## Key design decisions

- **Fresh start** — no data migration, existing data discarded
- **signal_log replaces signal_history** — rename + upgrade to hypertable
- **Unit normalization** built in — SettingDistanceUnit etc. are just signals in the log
- **No in-memory accumulation** — session completion queries signal_log
- **3-tier resilience** — memory buffer → Redis backup → MQTT persistence
- **Continuous aggregates** replace snapshot table reads for dashboards

## Prompt ordering (34 atomic prompts)

```
── Foundation ──
00 — Rename signal_history → signal_log, hypertable conversion + compression + value_jsonb
01 — Unique constraint + dedup guard (prevent multi-pod double writes)
02 — Redis HSET write path (fire-and-forget on every signal batch)
03 — Redis HSET read path (startup recovery, replaces vehicle_live_state load)

── Resilience ──
04 — Write-ahead buffer (extend for DB outage, rate-limited drain on recovery)
05 — Redis backup list (secondary log during DB outage, drain on recovery)

── Core logic ──
06 — SnapshotAt + SnapshotBetween helpers (point-in-time reconstruction)
07 — Unit conversion helpers (Go + frontend, NormalizeDistance/Temp/Pressure)
08 — Signal alias registry (handle Tesla signal name changes at ingestion)
09 — Drive completion rewrite (SnapshotAt start/end, unit-aware, no accumulation)
10 — Charge completion rewrite (same pattern as drive)
11 — Session recovery on startup (find open drives/charges, complete from signal_log)

── Cleanup (remove legacy) ──
12 — Drop snapshot writer code (9 repos + telemetry handler dispatch paths)
13 — Drop snapshot tables + vehicle_live_state (migration to remove from schema)
14a — Rewire handlers: vehicle_live_state → Redis (4 handlers)
14b — Rewire handlers: battery_snapshots → signal_log (3 handlers)
14c — Rewire handlers: charging_telemetry → signal_log (6 handlers)
14d — Rewire handlers: drive_telemetry_readings → signal_log (2 handlers)

── Dashboard + real-time ──
15 — Continuous aggregates (replace snapshot table reads for dashboards)
16 — Frontend unit conversion (display in user's preferred units)

── Cross-cutting (SSE, FSM, workers, frontend types) ──
18 — SSE push path: Redis Pub/Sub replaces in-memory broadcast
19 — FSM + Automation engine: read from Redis instead of vehicle_live_state
20 — Export + Backup workers: rewire for signal_log
21 — Frontend types: remove dropped table interfaces, update API types

── Telemetry endpoints (pivot + rewire) ──
23 — SignalTracePivot helper (vertical → horizontal chart data)
24 — Drive telemetry + positions: rewire to signal_log via pivot
25 — Charge telemetry: rewire to signal_log via pivot
26a — Tire pressure + climate endpoints: rewire to signal_log
26b — Security + safety + media endpoints: rewire to signal_log
26c — Location + user-prefs + vehicle-config endpoints: rewire to signal_log
27 — Live active drive/charge: in-progress session detail in UI

── Gate ──
28 — Gate: build + tsc + replay signals + verify sessions + verify no legacy refs
```

## Supersedes

- **Phase 12** (signal pipeline — simpler version) — fully replaced
- **Future-1** (unit normalization — 19 prompts) — absorbed into prompts 07, 09, 10, 16
