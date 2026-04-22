---
description: "Phase 10 — 7-day daily metrics check template + watch list + escalation thresholds"
---

# 🔵 Soak 02 — Daily Checks (Days 1–7)

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 2 of 3

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | 7 daily JSON snapshots in `logs/phase-10-02-day-N.json` + watchlist.md |
| Depends on | `01-preflight`; staging cluster updated to merge-ready branch |
| Blocks | `03-go-no-go-decision` |

## Single Goal

Run the same metric snapshot query daily for 7 days against staging, file each as `phase-10-02-day-N.json`, compare against prod baseline, and call out any threshold breach.

## What's Being Established

Soak duration was set at 7 days because: 3 days catches initial CAGG backfill spikes; 7 days catches first compression policy run; first retention drop window starts after that.

## Recommendation

### Metrics (same as preflight)

Capture the same 8 metric categories from prompt 01, but tagged `source: "staging"`.

### Threshold table (escalate if any breach)

| Metric | Threshold (vs prod baseline) | Action on breach |
|--------|------------------------------|------------------|
| API p95 per route | > 2× baseline | Capture EXPLAIN ANALYZE; check missing indexes; profile |
| Telemetry write rate | < 0.5× baseline | Check Fleet Telemetry config + MQTT subscriber; profile bulk insert path |
| DB growth / day | > 1.5× baseline | Verify compression policy runs; check signal_observations row count |
| CAGG refresh p95 | > 3× baseline | Check materialization lag; consider chunk_time_interval change |
| Error rate (5xx) | > 0.5% over 1h | Investigate immediately; potential rollback |
| Automation eval lag | > 30s p95 | Check FSM nil-map regression; verify connFSMs init |

### Daily snapshot format

```json
{
  "captured_at": "2025-10-01T08:00:00Z",
  "source": "staging",
  "soak_day": 1,
  "metrics": { ... },
  "delta_vs_baseline": {
    "telemetry_writes_per_sec": "+3%",
    "api_p95_ms_by_route": { "/api/v1/drives": "+12%" },
    "db_size_bytes": "+47MB"
  },
  "incidents": [],
  "notes": "First-day metric. CAGG refreshes ran cleanly at 02:00 UTC."
}
```

### `watchlist.md` (companion human-readable doc)

```markdown
# Phase 10 Soak — Watchlist

| Day | Date | Captured | Threshold breach | Notes |
|----:|------|----------|------------------|-------|
| 1   |      | ⬜       | none / list      |       |
| 2   |      | ⬜       |                  |       |
| 3   |      | ⬜       |                  |       |
| 4   |      | ⬜       |                  |       |
| 5   |      | ⬜       |                  |       |
| 6   |      | ⬜       |                  |       |
| 7   |      | ⬜       |                  |       |
```

## Suggested Fix

1. Day 1: capture, compare, file, commit
2. Days 2-6: same routine; commit each day
3. Day 7: capture + roll into prompt 03's go/no-go input
4. If a threshold breach occurs, do NOT silently proceed — document in watchlist + ping owner

## Acceptance Criteria

- [ ] 7 day-N JSON files exist in `logs/phase-10-02-day-N.json` (N=1..7)
- [ ] `watchlist.md` filled with all 7 days, breach column populated
- [ ] If any breach occurred and was not resolved, prompt 03 must NOT issue "go"
- [ ] Each day committed (one commit per capture is fine)

## Verification

```powershell
$days = Get-ChildItem .github\prompts\db-refactor\logs\phase-10-02-day-*.json
Write-Host "Days captured: $($days.Count) (expected 7)"
Get-Content .github\prompts\db-refactor\watchlist.md
```

## Out of Scope

- Don't tune indexes during soak (would change the test conditions); collect findings for a follow-up
- Don't deploy to prod (Phase 11)
- Don't shorten soak below 7 days (compression policy must execute at least once)

## Commit When Done (one commit per day)

```powershell
cd D:\repos\teslasync
$N = <day-number>
git add -f .github/prompts/db-refactor/logs/phase-10-02-day-$N.json
git add .github/prompts/db-refactor/watchlist.md
git commit -m "ops(db-refactor): Phase 10.02 — staging soak day $N snapshot

<one-line summary of any breach or "all metrics within threshold">

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 10 prompt 01
- ADR-003 (compression / retention)
