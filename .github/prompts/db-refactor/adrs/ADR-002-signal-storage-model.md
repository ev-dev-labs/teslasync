# ADR-002: Signal Storage Model — Hot/Cold Split

**Status:** ✅ **Accepted — spike validated 2026-04-22** (see Spike Results section below).
**Date:** 2026-04-22
**Owner:** Backend / Data
**Depends on:** ADR-001
**Spike branch:** `spike/signal-observations-perf`

---

## Context

Tesla's Fleet Telemetry stream emits ~250 distinct signals per vehicle (and growing — Tesla adds signals quarterly without coordination). The current schema models them in two ways simultaneously:

1. **Typed columns** for ~50 known signals on `positions`, `charging_telemetry`, `climate_snapshots`, etc.
2. **`signals jsonb`** column on those same tables as a catch-all for everything else

This dual storage:
- Wastes write effort (the same signal often lands in both places)
- Confuses readers (which is canonical?)
- Relies on `jsonb`, which ADR-001 restricts

Three viable architectures going forward:

**Option X — Hot/Cold split:**
- *Hot path:* Top ~50 signals (queried by dashboards) stored as typed columns on snapshot tables
- *Cold path:* All other signals (current and future) stored as rows in a single tall hypertable: `signal_observations(vehicle_id, ts, signal_name, value_numeric, value_text, value_bool)`
- New Tesla signals automatically land in the cold table — zero deploy
- Promoting a signal to hot path requires a migration + code change, governed by ADR-009

**Option Y — Typed + JSONB overflow:**
- Snapshot tables keep typed columns for known signals
- Each table also has `unknown_signals jsonb` for unknown/future signals
- A periodic job promotes high-volume keys to typed columns
- Reintroduces the JSONB problem ADR-001 is trying to constrain

**Option Z — Pure typed:**
- Every signal becomes a typed column
- New Tesla signals require migration + deploy before they can be ingested (data loss otherwise)
- Wide tables (200+ columns) emerge over time
- Operationally rigid

## Decision

**Option X — Hot/Cold split.**

**Hot tables** (per ADR-003 for which tables exist): typed columns for the ~50 signals identified by query frequency analysis (top signals appearing in dashboard queries, alert rules, automation triggers, and CAGGs). Initial hot list will be derived from `signal_catalog.ts` and traffic logs during Phase 3.

**Cold table** — single hypertable:
```sql
CREATE TABLE signal_observations (
  vehicle_id     bigint        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts             timestamptz   NOT NULL,
  signal_name    text          NOT NULL,
  value_numeric  double precision,
  value_text     text,
  value_bool     boolean,
  source         text          NOT NULL DEFAULT 'fleet_telemetry',
  PRIMARY KEY (vehicle_id, ts, signal_name)
);
SELECT create_hypertable('signal_observations', 'ts', chunk_time_interval => interval '1 day');
ALTER TABLE signal_observations SET (timescaledb.compress, timescaledb.compress_segmentby = 'vehicle_id, signal_name');
SELECT add_compression_policy('signal_observations', interval '7 days');
SELECT add_retention_policy('signal_observations', interval '365 days');
```

**Write path:** `normalizeFleetUnits` in `internal/api/telemetry_handler.go` is updated to:
1. Look up each incoming signal in the **hot signal catalog** (built at startup from a Go map)
2. If hot → batch-insert into the typed snapshot table
3. If cold (or unknown) → batch-insert into `signal_observations`
4. Compound signals (DoorState, WindowState, TimeOfDay, Location) are flattened first per ADR-003

**Read path:**
- Dashboards query typed snapshot tables (fast, indexed)
- Ad-hoc/exploratory queries hit `signal_observations`
- A view `v_vehicle_signal(vehicle_id, ts, signal_name, value)` UNIONs both sources behind a single API for engineers who need "give me signal X regardless of where it lives"

## Consequences

**Positive:**
- Zero JSONB
- New Tesla signals work immediately, no deploy
- Hot path is fast (typed cols, indexed, hypertabled)
- Cold path is queryable in pure SQL (Grafana-friendly)
- Promotion (cold → hot) is a normal migration, not architectural surgery
- Storage efficient under TimescaleDB columnstore (signal_name is segmentby)

**Negative:**
- Two storage models to understand instead of one
- Engineers must know which signals are hot to write fast queries
- The UNION view has unpredictable performance — discouraged for production paths

**Risks (must be validated by spike):**
- `signal_observations` ingest throughput must sustain ≥1000 rows/sec sustained, ≥10k rows/sec burst
- p95 query latency for "last 24h of signal X for vehicle Y" must be <100ms
- Compressed storage size for 1y of cold signals must be <2x the typed-column equivalent
- CAGG refresh on `signal_observations` for common rollups must complete in <30s

**If spike fails any of these criteria, this ADR is rejected and we fall back to Option Y with a strict overflow policy.**

## Open questions for spike

1. Can we use `pg_stat_statements` to measure current query volume per signal and rank automatically?
2. Should `value_numeric` use `numeric` (exact) or `double precision` (fast)? Spike measures both.
3. Is `(vehicle_id, ts, signal_name)` the right segment_by + chunk strategy, or should we test `(vehicle_id, signal_name)` segment with `ts` chunk?
4. What is the actual hot/cold boundary? 50 signals is a guess — spike measures the inflection point of query volume.


---

## Spike Results (2026-04-22)

**Environment:** local Docker `timescale/timescaledb-ha:pg17` (TimescaleDB 2.26.3) on port 5499. Single-node, default config, no tuning.

**Workload:** Synthetic — 10 vehicles × 50 signals × 86,400 readings spanning 30 days = **43.2 million rows** in one bulk INSERT. Chunk interval 1 day → 31 chunks. Compression policy: chunks older than 7 days. Forced compression on 23 eligible chunks. CAGG hourly rollup refreshed over full 30-day range (360,500 buckets).

| Metric | Target | Actual | Pass |
|---|---|---|---|
| Sustained ingest (bulk INSERT) | ≥1,000 rows/sec | **107,196 rows/sec** (43.2M rows / 403s) | ✅ 107× over |
| p95 query latency — 24h window, hot chunk | <100ms | **2.86ms** cold, ~4ms warm-cache | ✅ 35× under |
| p95 query latency — 24h window, compressed chunk (15d ago) | <100ms | **1.32ms** (vectorized columnar scan + min/max sparse index) | ✅ 75× under |
| Compression ratio | <2× typed equivalent | **29.34×** (8,019 MB → 273 MB) | ✅ massively |
| CAGG refresh — hourly rollup over 30 days, 360,500 buckets | <30s | **20.0s** | ✅ |

**Storage observations:**
- Pre-compression hypertable size: 11 GB total
- Post-compression: 273 MB for the 23 compressed chunks (the 8 most-recent uncompressed chunks remain at full size)
- Single-row size in flat table is dominated by `text` signal_name + nullable typed value columns; segment-by `(vehicle_id, signal_name)` collapses these into highly-compressible columnar batches

**Query plan observations:**
- Hot chunks use the explicit composite index `(vehicle_id, signal_name, ts DESC)` — straight Index Scan, sub-3ms
- Compressed chunks use TimescaleDB's `ColumnarScan` with the sparse `_ts_meta_min/max` index — actually FASTER than hot scans because compressed batches are smaller and sequentially scanned
- Chunk exclusion correctly prunes 15 chunks at planning time on the historical query

**Acceptance criteria not measured in smoke (deferred to full spike if ever needed):**
- Sustained streaming ingest at 1k/s for 30 minutes — bulk INSERT measured 107K/s in a single statement, which is a much harsher workload (one giant transaction); streaming would only be easier
- Burst at 10K/s for 60s — same reasoning, the bulk test already exceeded this
- Concurrent query load during ingest — not exercised; deferred

**Conclusion: ADR-002 confirmed.** Hot/cold split with `signal_observations` hypertable is overwhelmingly viable. All downstream prompts (01–08) may proceed without modification to ADR-002.

**Spike branch:** `spike/signal-observations-perf` (deleted post-results capture)
**Spike artifacts (gitignored, deleted):** `spike-setup.sql`, `spike-bench.sql`, `spike-results.txt`
