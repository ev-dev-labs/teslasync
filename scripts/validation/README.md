# Validation & Regression Harness

Tools that prove the database refactor (JSONB signals, hypertables,
continuous aggregates, compat views, PgBouncer) is **semantically
equivalent** to the pre-refactor behavior. Silent regressions — same
queries returning different numbers — are the main failure mode this
harness is built to catch.

All scripts read `DATABASE_URL` and are safe to run against a production
replica (read-only; `schema_parity_test.sh` is the only exception and
owns its own throw-away database).

## Scripts

| Script | What it proves |
|---|---|
| `schema_parity_test.sh`      | A fresh migrate produces an identical schema to an upgraded one. |
| `data_parity.sql`            | Every JSONB-backfilled value equals its native column (pre-drop). |
| `analytics_parity_test.sh`   | Every `fn_*` function returns identical rows to its snapshot. |
| `cagg_parity_test.sql`       | Each CAGG matches a manual `GROUP BY` over the raw hypertable. |
| `grafana_smoke_test.sh`      | Every Grafana dashboard panel query still executes. |
| `performance_benchmark.sql`  | EXPLAIN ANALYZE for the 10 hottest production queries. |
| `validation_checklist.sql`   | Row counts, backfill, hypertables, CAGGs, compression, views. |

Go-side helpers:

| File | Purpose |
|---|---|
| `internal/database/shadow_read.go` | Run old + new query in parallel and log divergence; caller receives the old result. |
| `internal/api/contract_test.go`    | Env-gated HTTP smoke test asserting each endpoint's required fields. |

## Typical workflow

```bash
export DATABASE_URL="postgres://teslasync:pass@localhost:5432/teslasync?sslmode=disable"

# BEFORE the risky migration — capture baselines
bash scripts/validation/analytics_parity_test.sh          # creates snapshots/
psql "$DATABASE_URL" -f scripts/validation/performance_benchmark.sql \
    | tee perf_before.txt

# Run the migration
go run ./cmd/teslasync --migrate-only

# AFTER the migration — prove equivalence
bash scripts/validation/schema_parity_test.sh
psql "$DATABASE_URL" -f scripts/validation/data_parity.sql
bash scripts/validation/analytics_parity_test.sh          # compares vs snapshots
psql "$DATABASE_URL" -f scripts/validation/cagg_parity_test.sql
psql "$DATABASE_URL" -f scripts/validation/validation_checklist.sql
psql "$DATABASE_URL" -f scripts/validation/performance_benchmark.sql \
    | tee perf_after.txt

# Optional — Grafana
GRAFANA_URL=http://localhost:3000 GRAFANA_TOKEN=glsa_xxx \
  bash scripts/validation/grafana_smoke_test.sh

# API contract (requires the server to be up)
TESLASYNC_API_URL=http://localhost:8080 \
  go test -run TestAPIContracts ./internal/api/...
```

`analytics_parity_test.sh` stores JSON snapshots under `snapshots/` and
fails on any divergence. Re-baseline an intentional change with
`REFRESH=1 bash scripts/validation/analytics_parity_test.sh`.

## Shadow-read canary (production)

`ShadowRead` in `internal/database/shadow_read.go` lets the API execute
the old (source-of-truth) query and, **in the background**, re-run a
new candidate query. Divergent results are logged (`level=warn
shadow_read=...`) but never affect the response. Use it to vet a
query rewrite with real production traffic before flipping the switch.
