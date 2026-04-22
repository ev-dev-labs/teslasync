---
description: "Phase 9 — Verify all 7 hypertables have compression + retention policies registered"
---

# 🔴 Acceptance 06 — Hypertable Policies

> **Severity:** Merge-gate | **Priority:** High | **Prompt #:** 6 of 7

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Query log enumerating all 7 × 2 policies |
| Depends on | Phase 9 prompt 03 |
| Blocks | Phase 9 prompt 07 |
| ADR refs | ADR-003 |

## Single Goal

Prove every Phase 3 hypertable has BOTH a compression policy AND a retention policy registered with TimescaleDB. Disk-cost ceiling depends on this.

## What's Being Established

ADR-003 enumerates 7 hypertables. Each one's Phase 3 prompt should have called `add_compression_policy` and `add_retention_policy`. Missing policies = unbounded disk growth.

## Recommendation

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-9-06-policies.log"

docker exec teslasync-postgres psql -U teslasync -d teslasync -c @"
WITH ht AS (
  SELECT hypertable_name FROM timescaledb_information.hypertables
  WHERE hypertable_schema = 'public'
),
comp AS (
  SELECT hypertable_name, compress_after::text AS compress_after
  FROM timescaledb_information.jobs j
  JOIN timescaledb_information.job_stats js USING (job_id)
  WHERE proc_name = 'policy_compression'
),
ret AS (
  SELECT hypertable_name, drop_after::text AS drop_after
  FROM timescaledb_information.jobs
  WHERE proc_name = 'policy_retention'
)
SELECT
  ht.hypertable_name,
  COALESCE(comp.compress_after, '<MISSING>') AS compression,
  COALESCE(ret.drop_after,      '<MISSING>') AS retention
FROM ht
LEFT JOIN comp USING (hypertable_name)
LEFT JOIN ret  USING (hypertable_name)
ORDER BY ht.hypertable_name;
"@ 2>&1 | Tee-Object -FilePath $log
```

Expected: 7 rows. NO occurrences of `<MISSING>` in either column.

## Acceptance Criteria

- [ ] Query returns 7 rows (all hypertables)
- [ ] No `<MISSING>` values in compression or retention columns
- [ ] Each compression policy has a sensible `compress_after` (e.g. 7 days for high-volume, 30 days for low)
- [ ] Each retention policy has a defined `drop_after` (e.g. 365 days for raw signals, longer for snapshots)
- [ ] Log saved
- [ ] Committed

## Verification

```powershell
Get-Content .github\prompts\db-refactor\logs\phase-9-06-policies.log
Select-String -Path .github\prompts\db-refactor\logs\phase-9-06-policies.log -Pattern "<MISSING>"
# Expected: 0 hits
```

## Out of Scope

- Don't tune the policy intervals here — that's Phase 10 (staging soak observes real disk growth and recommends adjustments)
- Don't add policies to non-hypertables

## Commit When Done

```powershell
git add -f .github/prompts/db-refactor/logs/phase-9-06-policies.log
git commit -m "test(db-refactor): Phase 9.06 — all 7 hypertables have compression + retention policies

ADR-003: full policy coverage verified. No <MISSING> entries.
Phase 10 will tune intervals based on staging observations.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-003
- Phase 3 hypertable creation prompts (08, 11, 12, 13, 14, 15, 17 — verify exact list against your Phase 3 README)
