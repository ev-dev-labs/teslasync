---
description: "Phase 9 — Prove zero-jsonb invariant: exactly one jsonb column in public schema"
---

# 🔴 Acceptance 04 — Zero-JSONB Invariant

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 4 of 7

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Query log showing exactly 1 row |
| Depends on | Phase 9 prompt 03 |
| Blocks | Phase 9 prompts 05–07 |
| ADR refs | ADR-001 |

## Single Goal

Run the canonical jsonb inventory query and prove exactly one row remains: `automation_step_actions.command_params`. Any other jsonb column is a refactor regression.

## What's Being Established

ADR-001 says zero jsonb except sole carve-out. Anything else means a Phase 3 prompt missed a column or Phase 5 added a struct field with the wrong type tag.

## Recommendation

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-9-04-jsonb-inventory.log"

docker exec teslasync-postgres psql -U teslasync -d teslasync -c @"
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE data_type IN ('jsonb', 'json')
  AND table_schema NOT IN ('pg_catalog', 'information_schema', '_timescaledb_internal', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_cache')
ORDER BY table_schema, table_name, column_name;
"@ 2>&1 | Tee-Object -FilePath $log

# Count check
docker exec teslasync-postgres psql -U teslasync -d teslasync -tAc @"
SELECT count(*) FROM information_schema.columns
WHERE data_type IN ('jsonb','json')
  AND table_schema = 'public';
"@
# Expected: 1
```

If count > 1, the extra columns must be removed (open the corresponding Phase 3 prompt or Phase 5 struct file). Do NOT proceed to prompt 05.

## Acceptance Criteria

- [ ] Query result shows exactly 1 row in `public` schema
- [ ] That row is `automation_step_actions.command_params` (or whatever the chosen carve-out table named it)
- [ ] Log saved
- [ ] Committed

## Verification

```powershell
Get-Content .github\prompts\db-refactor\logs\phase-9-04-jsonb-inventory.log
```

## Out of Scope

- Don't audit `_timescaledb_*` schemas — those are TS internals
- Don't audit `pg_catalog` — Postgres internals

## Commit When Done

```powershell
git add -f .github/prompts/db-refactor/logs/phase-9-04-jsonb-inventory.log
git commit -m "test(db-refactor): Phase 9.04 — zero-jsonb invariant holds

ADR-001: 1 jsonb column remains (automation_step_actions.command_params).
All other typed-out per Phase 3 schema. Inventory log captured.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-001
- Phase 3 prompt 16 (sole jsonb carve-out)
