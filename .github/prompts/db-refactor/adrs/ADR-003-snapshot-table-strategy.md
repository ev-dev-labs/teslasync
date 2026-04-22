# ADR-003: Snapshot Table Strategy — Per Write-Frequency Tier

**Status:** Accepted (2026-04-22)
**Date:** 2026-04-22
**Owner:** Backend / Data
**Depends on:** ADR-002

---

## Context

The current schema has 10 snapshot tables, each capturing a subset of vehicle state at time T:

| Table | Approx write freq | Primary signals |
|---|---|---|
| `positions` | 1-10 Hz when driving | location, speed, heading, elevation |
| `charging_telemetry` | 1 Hz when charging | charge state, voltage, amperage, soc |
| `climate_snapshots` | 0.1-1 Hz when climate active | inside/outside temp, hvac state, seat heaters |
| `motor_snapshots` | 1-10 Hz when driving | motor rpm, torque, power, temps |
| `security_events` | event-driven (rare) | doors, windows, locks, sentry events |
| `tire_pressure_snapshots` | once per drive | TPMS pressures and temps |
| `media_snapshots` | event-driven (song change) | media source, track info, volume |
| `safety_snapshots` | event-driven (rare) | autopilot state, FCW, blind spot, etc. |
| `vehicle_config_snapshots` | rare (firmware update) | software version, options, model variant |
| `user_preference_snapshots` | rare (user setting change) | drive mode, regen, climate prefs |

This is **10 separate write paths** for what is conceptually one event ("the vehicle's state changed"). Two design questions:

1. Is splitting by signal group justified, or accidental?
2. If kept separate, how are they consolidated when consumed (dashboards, exports)?

The split is justified when tables differ in:
- **Write frequency** (high-freq tables benefit from separate hypertables and compression policies)
- **Retention requirements** (positions: 1y, vehicle_config: forever)
- **Query patterns** (motor data only queried by perf analytics; positions queried by every dashboard)

The split is *not* justified when tables exist purely because the original developer followed a "one signal group, one table" pattern. That pattern produces operational sprawl: 10 hypertables, 10 compression policies, 10 retention policies, 10 sets of indexes to maintain.

## Decision

**Keep 5 high-frequency snapshot tables. Consolidate the 5 low-frequency tables into one wide `vehicle_meta_snapshots` table.**

### Keep separate (high-frequency tier — different write rates and retention)
| Table | Hypertable | Chunk interval | Compression after | Retention |
|---|---|---|---|---|
| `positions` | yes | 1 day | 7 days | 365 days |
| `charging_telemetry` | yes | 1 day | 7 days | 730 days |
| `climate_snapshots` | yes | 1 day | 14 days | 180 days |
| `motor_snapshots` | yes | 1 day | 7 days | 90 days |
| `security_events` | yes | 7 days | 30 days | 1825 days (5y, audit) |

### Consolidate (low-frequency tier — all event-driven, similar retention)
**One new table:** `vehicle_meta_snapshots`
- Combines: `tire_pressure_snapshots`, `media_snapshots`, `safety_snapshots`, `vehicle_config_snapshots`, `user_preference_snapshots`
- Schema: typed columns for the union of hot signals from all 5 source tables, plus a discriminator `category text NOT NULL` (one of `tire`, `media`, `safety`, `config`, `preference`)
- Hypertable: yes, 7-day chunks, compression after 30 days, retention 730 days

The discriminator allows partial inserts (write only tire-related columns when category='tire'). Columns from non-matching categories stay NULL. This is acceptable because:
- Writes are infrequent (event-driven, not streaming)
- Storage of NULLs in TimescaleDB columnstore is essentially free after compression
- Reading code uses `WHERE category = 'tire'` which is index-friendly
- One write path beats five for code maintainability

### Cold-path signals from any table
Per ADR-002, signals not in the typed columns of either tier go to `signal_observations`.

## Consequences

**Positive:**
- 6 hypertables instead of 10 (40% reduction in operational surface)
- Consolidated low-freq table reduces 5 nearly-identical write paths to 1
- Each table's compression/retention is tuned to its actual data lifecycle
- Consumers of low-freq data can use a single query with `WHERE category = ?`

**Negative:**
- `vehicle_meta_snapshots` will be a wider table (~30-40 columns when summed)
- The `category` discriminator must be carefully managed — typo'd values create silent data loss. Mitigation: enforce as enum or CHECK constraint.
- Schema migrations to add fields require deciding which category they belong to

**Neutral:**
- Code generation for repos becomes slightly different per tier (per-category accessors)
- Grafana dashboards for low-freq data need a `WHERE category = ?` filter — minor

**Open questions resolved during Phase 3 (schema design):**
- Exact hot column list per table (driven by spike data + traffic analysis)
- Whether `safety_snapshots` should stay separate due to its long audit retention — TBD pending compliance review
