# 00 — Spike: signal_observations Performance Validation

**Phase:** 2 (de-risk ADR-002)
**Branch:** `spike/signal-observations-perf` — fork from `final-enhanced-commands`
**Disposable:** Yes — branch is deleted after results are captured
**Estimated effort:** 1 day

---

## Goal

Validate ADR-002's hot/cold split is viable. If any acceptance criterion fails, reject ADR-002 and fall back to Option Y (typed columns + `unknown_signals jsonb` overflow).

## Acceptance criteria (from ADR-002)

| Metric | Target |
|---|---|
| Sustained ingest into `signal_observations` | ≥1000 rows/sec for 30 minutes |
| Burst ingest | ≥10,000 rows/sec for 60 seconds |
| p95 query latency: "last 24h of signal X for vehicle Y" | <100ms |
| Compressed storage size for 1y of cold signals | <2x equivalent typed-column storage |
| CAGG refresh time for hourly rollup of `signal_observations` | <30s |

---

## Setup

1. From `D:\repos\teslasync` create the spike branch:
   ```powershell
   git fetch origin
   git checkout -b spike/signal-observations-perf origin/final-enhanced-commands
   ```

2. Add a single new migration `migrations/000142_signal_observations_spike.up.sql`:
   ```sql
   CREATE TABLE signal_observations (
     vehicle_id    bigint           NOT NULL,
     ts            timestamptz      NOT NULL,
     signal_name   text             NOT NULL,
     value_numeric double precision,
     value_text    text,
     value_bool    boolean,
     source        text             NOT NULL DEFAULT 'fleet_telemetry',
     PRIMARY KEY (vehicle_id, ts, signal_name)
   );
   SELECT create_hypertable('signal_observations', 'ts', chunk_time_interval => interval '1 day');
   ALTER TABLE signal_observations SET (
     timescaledb.compress,
     timescaledb.compress_segmentby = 'vehicle_id, signal_name'
   );
   SELECT add_compression_policy('signal_observations', interval '7 days');
   ```
   (with matching `.down.sql`)

3. Build a CLI replay tool `cmd/spike-replay/main.go`:
   - Reads from a source (either `backups/data.dump` restored to a sandbox, OR synthesizes load from `internal/enums/signal_types.go` signal definitions)
   - Inserts into `signal_observations` using `pgx.CopyFrom` for bulk and parameterized INSERT for streaming
   - Emits metrics every 10s: rows/sec, lag (system time - max(ts))
   - Flags: `--mode=replay|synth`, `--rate=1000`, `--duration=30m`, `--burst=10000`, `--burst-duration=60s`

4. Build a query benchmark tool `cmd/spike-querybench/main.go`:
   - Issues N concurrent reads of "last 24h of signal X for vehicle Y" with random X
   - Uses signals seeded from `signal_catalog` (or a fixed list of 20)
   - Reports p50, p95, p99, p999 latency

5. Optional: define one CAGG to test refresh time:
   ```sql
   CREATE MATERIALIZED VIEW cagg_signal_observations_hourly
   WITH (timescaledb.continuous) AS
   SELECT vehicle_id, signal_name, time_bucket('1 hour', ts) AS hour,
          avg(value_numeric) AS avg_num, count(*) AS cnt
   FROM signal_observations
   WHERE value_numeric IS NOT NULL
   GROUP BY vehicle_id, signal_name, hour
   WITH NO DATA;
   ```

## Execution

```powershell
# 1. Apply migration
docker exec -i teslasync-postgres psql -U teslasync -d teslasync < migrations\000142_signal_observations_spike.up.sql

# 2. Sustained load
go run .\cmd\spike-replay --mode=synth --rate=1000 --duration=30m

# 3. Burst load (in parallel terminal during sustained)
go run .\cmd\spike-replay --mode=synth --rate=10000 --duration=60s

# 4. Query benchmark (during sustained load)
go run .\cmd\spike-querybench --concurrency=10 --duration=2m

# 5. Force compression on chunks older than 7 days (manually advance with chunk_time_min)
SELECT compress_chunk(c) FROM show_chunks('signal_observations') c LIMIT 5;

# 6. Storage measurement
SELECT
  pg_size_pretty(hypertable_size('signal_observations'::regclass)) AS total_size,
  pg_size_pretty(sum(after_compression_total_bytes)) AS compressed_size,
  pg_size_pretty(sum(before_compression_total_bytes)) AS uncompressed_size
FROM hypertable_compression_stats('signal_observations');

# 7. CAGG refresh
\timing on
CALL refresh_continuous_aggregate('cagg_signal_observations_hourly', NULL, NULL);
```

## Capture results in ADR-002

Open `.github/prompts/db-refactor/adrs/ADR-002-signal-storage-model.md` and append a new section:

```markdown
## Spike Results (2026-MM-DD)

| Metric | Target | Actual | Pass? |
|---|---|---|---|
| Sustained ingest | ≥1000/s | <ACTUAL>/s | ✅/❌ |
| Burst ingest | ≥10000/s | <ACTUAL>/s | ✅/❌ |
| p95 query latency | <100ms | <ACTUAL>ms | ✅/❌ |
| Compression ratio | <2x typed | <ACTUAL>x | ✅/❌ |
| CAGG refresh | <30s | <ACTUAL>s | ✅/❌ |

Conclusion: ADR-002 confirmed / rejected.
Spike branch SHA: <SHA>
```

## Cleanup

```powershell
# Drop spike artifacts from local DB
docker exec -i teslasync-postgres psql -U teslasync -d teslasync -c "DROP TABLE IF EXISTS signal_observations CASCADE;"

# Delete the spike branch (after results captured)
git checkout db-refactor/timescaledb-migration-mo-jsonb-at-all
git branch -D spike/signal-observations-perf
git push origin --delete spike/signal-observations-perf  # if pushed
```

## Exit gate

- [ ] All 5 metrics captured in ADR-002
- [ ] ADR-002 marked Accepted (or Rejected with explanation)
- [ ] Spike branch deleted
- [ ] No artifacts from this spike committed to the main refactor branch
