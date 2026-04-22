# ADR-007: Database Engine — TimescaleDB-HA pg17

**Status:** Accepted (locally validated 2026-04-21)
**Date:** 2026-04-22
**Owner:** Platform / SRE
**Depends on:** N/A

---

## Context

TeslaSync stores time-series telemetry (positions, motor, climate, charging) at high write rates. The current engine is plain PostgreSQL 17 (`postgres:17-alpine`). At fleet scale, three operational pain points motivate a change:

1. **Storage growth** — telemetry tables grow without bound; manual partitioning + retention is fragile
2. **Aggregation cost** — dashboard queries over 30-day rollups scan millions of rows
3. **Compression** — toast compression is per-row and weak for time-series

TimescaleDB addresses all three:
- Hypertables = automatic partitioning by time
- Continuous aggregates = incremental rollups maintained by the DB
- Columnstore compression = 10-95× compression on time-series segments

Two options were considered:

**Option A — Vanilla PG with pg_partman:**
- Same engine as today, no extension lock-in
- Manual rollup management
- Compression limited to TOAST
- Already proven in our environment

**Option B — TimescaleDB-HA pg17:**
- Built-in time partitioning
- CAGGs replace materialized views
- Columnar compression
- Adds dependency on Timescale Inc.'s extension
- Image bundles pgvector and pg_stat_statements (we use both)
- HA variant has logical replication, backups, and patroni baked in

A local validation (2026-04-21) executed the engine swap end-to-end:
- Stopped the existing postgres
- Brought up `timescale/timescaledb-ha:pg17`
- Restored full data with `pg_restore --data-only --single-transaction`
- All applications (api + 3 workers) came up healthy
- Row counts matched exactly: vehicles=1, drives=10, positions=14, charging_telemetry=77, climate=246, security=54, motor=42

## Decision

**Adopt `timescale/timescaledb-ha:pg17` as the database engine.**

### Configuration baked in
- PGDATA path: `/home/postgres/pgdata/data` (TS-HA convention; not vanilla PG path)
- Init script enables: `timescaledb`, `vector` (pgvector), `pg_stat_statements`
- Hypertables: as defined in ADR-003 (6 tables: positions, charging_telemetry, climate_snapshots, motor_snapshots, security_events, vehicle_meta_snapshots) plus `signal_observations` from ADR-002
- Compression policies: per-table from ADR-003
- Retention policies: per-table from ADR-003
- CAGGs: per ADR-006

### Helm chart updates required (Phase 5/6)
- New image: `timescale/timescaledb-ha:pg17` (pinned to a specific patch version, not `latest`)
- Init container or initdb script for extension creation
- Adjusted `volumeMounts.subPath` for the new PGDATA location
- Resources: same as before initially; revisit after staging soak

### Operational ownership
- Platform team owns: image upgrades, extension version management, CAGG refresh policy tuning
- Backend team owns: hypertable choices, compression segmentby, CAGG definitions

## Consequences

**Positive:**
- Storage cost predictable and reduced (compression typically 10-30× on telemetry)
- CAGGs eliminate cron-based rollup jobs
- Retention is automatic
- Local validation already proves the migration mechanics work
- pgvector available for future embeddings without a second engine

**Negative:**
- Extension dependency on Timescale Inc.; requires monitoring their release cadence
- CAGGs have eventual consistency (refresh lag) — must be communicated to dashboard owners
- Compressed chunks are read-only without explicit decompression; UPDATE/DELETE on old data requires `decompress_chunk` first

**Neutral:**
- TS-HA image is larger than alpine (~1.2GB vs ~250MB) — image pull time and node disk pressure
- Backup procedures are the same (pg_dump/restore) but should test with compression enabled

**Risks:**
- TimescaleDB community license restricts certain features (multi-node, etc.). Mitigation: we don't need them. Re-evaluate at scale.
- Extension upgrade across major TS versions is a real effort. Mitigation: pin TS version; treat as deliberate upgrade with its own ADR.
- Compressed columnstore changes write-path semantics (PostgreSQL `COPY` to compressed chunks fails). Mitigation: document; ensure all writers go through normal INSERT.
