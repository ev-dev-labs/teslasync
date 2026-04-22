# 08 — Staging Soak Runbook

**Phase:** 6
**Branch:** `main` (after Phase 5 PR is merged)
**Environment:** staging only — production untouched
**Duration:** ≥7 days
**Estimated effort:** ~30 min/day operational + investigation as issues arise

---

## Goal

Run the new schema in staging against real fleet telemetry for at least 7 consecutive days. Compare against the captured production baseline. Decide go/no-go for Phase 7 (prod cutover).

## Pre-flight (Day 0)

1. Phase 5 PR merged to `main`
2. Staging deploy points at `main` and pulls the new TimescaleDB-HA image
3. Staging is connected to a non-production telemetry source (either: a duplicated Tesla Fleet Telemetry stream, or a replay from production telemetry events)
4. Production captures these baseline metrics for comparison (run on prod, document):
   - Average ingest rate (rows/sec across all telemetry tables)
   - p50/p95/p99 latency for the top 10 dashboard endpoints
   - Storage growth rate (GB/day across all tables)
   - CAGG refresh time (where MVs exist on prod, time the equivalent REFRESH MATERIALIZED VIEW)

## Daily checks (Days 1-7)

Each day, capture the same metrics from staging and compare to prod baseline. Use the runbook table below; copy-paste fresh each day into a tracking issue.

### Daily metrics template

```
Day N (YYYY-MM-DD)
─────────────────────────────────────────────────────
Ingest rate:               <staging>/s   vs prod <baseline>/s   delta: ±X%
p95 latency / state:       <staging>ms   vs prod <baseline>ms   delta: ±X%
p95 latency / analytics:   <staging>ms   vs prod <baseline>ms   delta: ±X%
Storage growth:            <staging>GB/d vs prod <baseline>GB/d delta: ±X%
CAGG refresh (slowest):    <staging>s    vs prod <baseline>s    delta: ±X%
Error rate (5xx):          <staging>%    vs prod <baseline>%    delta: ±X%
Signal observations rows:  <total>
Signal catalog entries:    <total>
Unknown signals discovered: <list of new names since yesterday>
Issues observed:           <free text>
```

### Specific things to watch

**Day 1-2 — Sanity:**
- Does ingest catch up to the live stream? Or is it falling behind?
- Are any hot signals landing in `signal_observations` because the catalog is missing them? (Check `signal_catalog WHERE storage_tier='cold' AND signal_name IN (<hot list>)`)
- Any unexpected NULLs in typed columns where prod had values?

**Day 3-4 — Compression:**
- First chunks should hit their compression policy (positions: 7d → won't compress yet, but check chunk sizes are growing as expected)
- `pg_size_pretty(hypertable_size('positions'::regclass))` — track daily

**Day 5-6 — CAGG refresh:**
- All CAGGs should have refreshed at least once
- Check `timescaledb_information.job_stats` for any failures
- Compare CAGG output rows to equivalent ad-hoc query result counts

**Day 7 — End-to-end smoke:**
- Open every page in the staging UI; nothing throws
- Trigger an automation manually; observe execution log captured in `automation_executions`
- Send a test alert; verify it reaches the configured channel
- Run a data export job; verify CSV/JSON output looks right

## Go/No-go criteria for Phase 7

After 7 days, all of these must be true to proceed to prod cutover:

| # | Criterion | Threshold |
|---|---|---|
| G1 | Ingest sustained without backlog | Avg lag <30s across 7 days |
| G2 | p95 latency on top 10 endpoints | ≤ 1.2× prod baseline |
| G3 | Storage growth | ≤ 1.2× prod baseline |
| G4 | Error rate (5xx) | ≤ prod baseline |
| G5 | CAGG refresh times | ≤ 1.5× prod baseline (CAGGs are new; some headroom) |
| G6 | Zero data integrity issues | No "where did that value come from" tickets |
| G7 | All automations and alerts function | Manual test on day 7 passes |
| G8 | All exports produce identical output | Diff staging export vs prod export for same time window |
| G9 | Rollback tested | At least once during the week, deploy a known-good staging revert and verify it works |
| G10 | On-call team trained | Review runbook, ADRs, and Phase 7 playbook with the on-call rotation |

## What to do if a criterion fails

Don't proceed. Pick one:

- **Minor (G2/G5 slightly over):** Spend a day tuning (compression segmentby, CAGG bucket size, query rewrites). Re-soak for 2 more days; recheck.
- **Moderate (G3/G6):** Open a focused bug, fix on a sub-branch, deploy fix to staging, restart 7-day soak from day 1.
- **Major (G1/G4/G7/G9):** Root cause first. May indicate a fundamental design issue (e.g., signal_observations cardinality higher than spike measured). Re-evaluate ADR-002.

## Day 8: Sign-off ceremony

- Post a summary of all 10 criteria with evidence in a closed-room review
- On-call rotation explicitly accepts the new system
- Schedule the prod cutover window (Phase 7)
- Notify users via the standard maintenance window comms

## Phase 7 handoff

Once go/no-go = GO, switch to:
**`D:\repos\-k3s-gitops\.github\prompts\teslasync-ts-cutover\`**

Specifically:
- `00-overview.prompt.md` — read first
- `01-preflight.prompt.md` through `08-decommission-old-pg.prompt.md` — execute in order
- `99-rollback.prompt.md` — keep open in another tab during cutover

## Exit gate

- [ ] 7 days of daily metrics captured
- [ ] All 10 go/no-go criteria pass
- [ ] On-call rotation trained
- [ ] Prod cutover window scheduled
- [ ] Comms sent to users
- [ ] Phase 7 playbook reviewed and ready
