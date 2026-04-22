---
description: "Phase 10 — Capture prod baseline metrics before staging cutover so we have a comparison anchor"
---

# 🟢 Soak 01 — Preflight Baseline Capture

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 1 of 3

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | `.github/prompts/db-refactor/logs/phase-10-01-prod-baseline.json` |
| Depends on | Phase 9 sign-off |
| Blocks | `02-daily-checks` (needs anchor for delta) |

## Single Goal

Capture a snapshot of prod metrics (write throughput, query p95, disk growth/day, CAGG refresh time, automation eval time) so the 7-day staging watch has a comparison anchor.

## What's Being Established

Without a baseline, "is staging healthy?" is unanswerable. This prompt freezes the prod-as-of-today numbers into a JSON file checked into the branch.

## Recommendation

### Metrics to capture

| Metric | Source | Format |
|--------|--------|--------|
| Avg telemetry batches/sec (1h) | Prometheus `rate(teslasync_telemetry_batches_total[1h])` | float |
| Avg writes/sec (1h) | `rate(teslasync_telemetry_writes_total[1h])` | float |
| API p95 latency (1h) | `histogram_quantile(0.95, http_request_duration_bucket)` per endpoint | object |
| DB size (bytes) | `SELECT pg_database_size('teslasync')` | int |
| DB growth (last 24h) | tracked separately; estimate from snapshots | int |
| Hypertable sizes | `SELECT hypertable_name, total_bytes FROM timescaledb_information.hypertable_detailed_size` | array |
| CAGG refresh duration p95 | TS jobs view | object |
| Automation eval count/min | app metric | float |

### Capture script (read-only against prod)

```powershell
$baseline = @{
  captured_at = (Get-Date -AsUTC).ToString("o")
  source      = "production"
  prometheus  = "https://prom.prod.example.com"
  metrics     = @{
    telemetry_batches_per_sec = <query Prometheus>
    telemetry_writes_per_sec  = <query Prometheus>
    api_p95_ms_by_route       = @{ "/api/v1/vehicles" = 12; "/api/v1/drives" = 28; ... }
    db_size_bytes             = <psql query>
    hypertable_sizes_bytes    = @{ positions = ...; signal_observations = ...; ... }
    cagg_refresh_p95_seconds  = @{ daily_drive_summary = ...; ... }
    automations_per_min       = <query>
  }
  notes = "Baseline anchor for db-refactor staging soak. Numbers vary ±20% over typical day; treat as order-of-magnitude reference, not strict targets."
}
$baseline | ConvertTo-Json -Depth 5 | Set-Content .github\prompts\db-refactor\logs\phase-10-01-prod-baseline.json
```

## Suggested Fix

1. Open Prometheus / Grafana for prod
2. Run the queries above
3. `psql` to prod read replica for DB sizes
4. Fill in the JSON template above
5. Commit (treat as an immutable historical record)

## Acceptance Criteria

- [ ] `phase-10-01-prod-baseline.json` exists with all 8 metric categories filled
- [ ] `captured_at` is an ISO timestamp
- [ ] All hypertables present in the size map
- [ ] Committed

## Verification

```powershell
Get-Content .github\prompts\db-refactor\logs\phase-10-01-prod-baseline.json | ConvertFrom-Json
```

## Out of Scope

- Don't deploy to staging in this prompt
- Don't write against prod — read-only queries only
- Don't capture per-vehicle metrics (aggregates only)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/logs/phase-10-01-prod-baseline.json
git commit -m "ops(db-refactor): Phase 10.01 — capture prod baseline metrics

Anchor numbers for write throughput, query p95, disk size, CAGG
refresh, and automation eval rate. Phase 10.02 will compare staging
deltas to these.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Old `prompts/08-staging-soak-runbook.prompt.md`
