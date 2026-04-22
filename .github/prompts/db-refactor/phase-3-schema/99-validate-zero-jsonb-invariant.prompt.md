---
description: "Phase 3 — Validate the zero-JSONB invariant across all 27 schema files (Phase 3 merge gate)"
---

# 🔴 Schema 99 — Validate Zero-JSONB Invariant (Phase 3 Merge Gate)

> **Severity:** Merge gate — Phase 3 is NOT done until every check below passes
> **Priority:** Highest (this is what makes Phase 3 a real gate, not paperwork)
> **Category:** Phase 3 — Validation
> **Prompt #:** 28 of 28 (final)

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | (none — runs invariant queries against the cumulative throwaway DB) |
| Depends on | All prompts 00 through 26 — every schema file must exist and have been applied |
| Blocks | Phase 5a (`02-assemble-baseline-migration`) cannot start until this passes |
| ADR refs | ADR-001 (the JSONB invariant), ADR-002 (hypertable count), ADR-003 (snapshot consolidation), ADR-004 (carve-out location) |
| Estimated effort | small (~15 min) |
| Throwaway DB role | runs final checks, then **tears down** `ts-schema-validate` |

## Single Goal

Prove that the entire Phase 3 schema, when applied in order, satisfies the binding invariants from the ADRs. Specifically: **exactly one** JSONB column exists in the schema, it is `automation_actions.command_params`, and seven hypertables exist with compression policies.

## What's Being Verified

The whole Phase 3 effort exists to make this gate pass. If it fails, an earlier prompt is wrong; fix it and re-run that prompt's commit, then re-run this one.

## Recommendation

Run all 8 invariant checks below. Each has an explicit expected result. **All must pass** for Phase 3 to be considered complete.

If you re-ran any prompt or the throwaway container was restarted, **reapply all schema files in order first** (script in step 2 below). The cumulative-DB pattern depends on prompts having run end-to-end without re-creation.

## Suggested Fix (implementation steps)

1. **Confirm container is alive:**
   ```powershell
   docker ps --filter name=ts-schema-validate --format '{{.Names}} {{.Status}}'
   ```
   If missing, start fresh and reapply (next step).

2. **Reapply all schema files in numeric order** (always safe — only needed if step 1 showed missing container, or if any prompt was re-run):
   ```powershell
   docker run -d --name ts-schema-validate -p 5499:5432 `
     -e POSTGRES_PASSWORD=v -e POSTGRES_DB=v `
     timescale/timescaledb-ha:pg17 2>&1 | Out-Null
   Start-Sleep -Seconds 12
   Get-ChildItem D:\repos\teslasync\.github\prompts\db-refactor\schema\*.sql |
     Sort-Object Name |
     ForEach-Object {
       Write-Host "Applying $($_.Name)..."
       Get-Content $_.FullName -Raw | docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1
     }
   ```

3. **Run all 8 invariant checks** (Verification section below). All must pass.

4. **Capture results** for the commit message (suggested format below).

5. **Tear down the throwaway container.**

6. **Commit the validation outcome** (empty commit — no file produced).

## Acceptance Criteria

- [ ] CHECK 1: returns exactly **1 row**: `automation_actions | command_params`
- [ ] CHECK 2: returns **0** (no `json` non-binary columns)
- [ ] CHECK 3: returns a comment containing `JSONB carve-out per ADR-001/ADR-004`
- [ ] CHECK 4: returns **0 rows** (every non-append-only table has `updated_at`)
- [ ] CHECK 5: returns **0 rows** (or every returned row was reviewed and confirmed deliberately ON DELETE NO ACTION)
- [ ] CHECK 6: returns **7 rows** — exactly: `charging_telemetry, climate_snapshots, motor_snapshots, positions, security_events, signal_observations, vehicle_meta_snapshots`
- [ ] CHECK 7: returns **0 rows** (every hypertable has a compression policy)
- [ ] CHECK 8: returns **≥3 CAGGs** (fleet stats, charging summary, signal hourly)
- [ ] Throwaway container `ts-schema-validate` removed after checks
- [ ] Empty commit recorded with check results in the message

## Verification

```powershell
# CHECK 1: exactly 1 jsonb column in public schema, and it's the carve-out
docker exec ts-schema-validate psql -U postgres -d v -c "
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'jsonb'
ORDER BY table_name, column_name;"
# Expected: 1 row — automation_actions | command_params

# CHECK 2: zero json (non-binary) columns anywhere
docker exec ts-schema-validate psql -U postgres -d v -c "
SELECT count(*) AS json_columns
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'json';"
# Expected: 0

# CHECK 3: the carve-out has the required COMMENT
docker exec ts-schema-validate psql -U postgres -d v -c "
SELECT col_description('automation_actions'::regclass, attnum)
FROM pg_attribute
WHERE attrelid = 'automation_actions'::regclass AND attname = 'command_params';"
# Expected: a comment containing 'JSONB carve-out per ADR-001/ADR-004'

# CHECK 4: every non-append-only table has updated_at
docker exec ts-schema-validate psql -U postgres -d v -c "
WITH append_only AS (
  SELECT unnest(ARRAY[
    'positions','charging_telemetry','climate_snapshots','motor_snapshots',
    'security_events','signal_observations','vehicle_meta_snapshots',
    'api_call_logs','audit_logs'
  ]) AS table_name
)
SELECT t.table_name
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND t.table_name NOT IN (SELECT table_name FROM append_only)
  AND t.table_name NOT IN (
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'updated_at' AND table_schema = 'public'
  );"
# Expected: 0 rows

# CHECK 5: every FK has explicit ON DELETE (catches accidental NO ACTION defaults)
docker exec ts-schema-validate psql -U postgres -d v -c "
SELECT conrelid::regclass AS table_name, conname, confdeltype
FROM pg_constraint
WHERE contype = 'f' AND confdeltype = 'a';"   -- 'a' = NO ACTION (the default if you forget ON DELETE)
# Expected: 0 rows. (If a row is intentional, leave it but justify in the prompt's commit.)

# CHECK 6: hypertable count
docker exec ts-schema-validate psql -U postgres -d v -c "
SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY hypertable_name;"
# Expected: 7 rows — charging_telemetry, climate_snapshots, motor_snapshots,
# positions, security_events, signal_observations, vehicle_meta_snapshots

# CHECK 7: every hypertable has a compression policy
docker exec ts-schema-validate psql -U postgres -d v -c "
SELECT h.hypertable_name
FROM timescaledb_information.hypertables h
LEFT JOIN timescaledb_information.jobs j
  ON j.hypertable_name = h.hypertable_name AND j.proc_name = 'policy_compression'
WHERE j.job_id IS NULL;"
# Expected: 0 rows

# CHECK 8: CAGGs registered
docker exec ts-schema-validate psql -U postgres -d v -c "
SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY view_name;"
# Expected: at least 3 — fleet stats, charging summary, signal hourly
```

## Cleanup

```powershell
# Phase 3 done — tear down the throwaway DB
docker rm -f ts-schema-validate
```

## Out of Scope (reject if asked)

- Don't write the actual migration here — that's `phase-5a-migration-baseline/`.
- Don't apply schema files to the real dev or prod DB. The throwaway container is the only target.
- Don't add new tables in this prompt. If a check reveals a missing table, write a new prompt for it (or amend an existing one) — never inline new DDL here.
- Don't loosen any check threshold to make it pass. If you have to, the design is wrong, not the check.

## Commit When Done

Empty commit — this prompt produces no `.sql` file, only validation evidence:

```powershell
cd D:\repos\teslasync
git commit --allow-empty -m "schema(db-refactor): Phase 3 invariants validated

All 27 schema files apply cleanly to a fresh TimescaleDB-HA pg17 DB.
JSONB invariant holds: exactly 1 column (automation_actions.command_params)
per ADR-001. 7 hypertables (positions, charging_telemetry, climate_snapshots,
motor_snapshots, security_events, signal_observations, vehicle_meta_snapshots),
all with compression policies. 3+ CAGGs registered.

Phase 3 complete; phase-5a-migration-baseline can begin.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md` — typed-by-default policy
- `.github/prompts/db-refactor/adrs/ADR-002-signal-storage-model.md` — signal_observations hypertable
- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md` — vehicle_meta_snapshots consolidation
- `.github/prompts/db-refactor/adrs/ADR-004-automation-schema.md` — the JSONB carve-out target
- `.github/prompts/db-refactor/phase-3-schema/README.md` — phase index
