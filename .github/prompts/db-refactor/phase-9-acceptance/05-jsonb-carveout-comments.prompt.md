---
description: "Phase 9 — Verify the sole jsonb column has an ADR-* COMMENT in pg_description"
---

# 🔴 Acceptance 05 — JSONB Carve-out Documentation

> **Severity:** Merge-gate | **Priority:** High | **Prompt #:** 5 of 7

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Query log showing carve-out comment |
| Depends on | Phase 9 prompt 04 |
| Blocks | Phase 9 prompts 06–07 |
| ADR refs | ADR-001 |

## Single Goal

Prove that the sole jsonb column (`automation_step_actions.command_params`) carries a `COMMENT ON COLUMN ... IS '...ADR-001...'` so future developers know it's an intentional exception, not a regression.

## What's Being Established

The Phase 3 prompt that created `automation_step_actions` should have included the comment. This gate verifies the comment exists and references ADR-001.

## Recommendation

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-9-05-jsonb-comment.log"

docker exec teslasync-postgres psql -U teslasync -d teslasync -c @"
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  pgd.description
FROM information_schema.columns c
JOIN pg_catalog.pg_statio_all_tables st
  ON st.schemaname = c.table_schema AND st.relname = c.table_name
LEFT JOIN pg_catalog.pg_description pgd
  ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
WHERE c.data_type IN ('jsonb','json')
  AND c.table_schema = 'public'
ORDER BY c.table_name, c.column_name;
"@ 2>&1 | Tee-Object -FilePath $log
```

Expected output (1 row):

```
 table_schema |       table_name        |  column_name   | data_type |                                description
--------------+-------------------------+----------------+-----------+--------------------------------------------------------------------
 public       | automation_step_actions | command_params | jsonb     | ADR-001 carve-out: Tesla command params are inherently dynamic ...
```

If `description` is NULL, add the comment via a fix-up migration:

```sql
COMMENT ON COLUMN automation_step_actions.command_params IS
  'ADR-001 carve-out: Tesla command params are inherently dynamic per command type; typing them would require a CTI-of-CTI we explicitly rejected in ADR-004.';
```

## Acceptance Criteria

- [ ] Query returns exactly 1 row
- [ ] `description` is non-null
- [ ] `description` contains the substring `ADR-001`
- [ ] Log saved
- [ ] Committed

## Verification

```powershell
Get-Content .github\prompts\db-refactor\logs\phase-9-05-jsonb-comment.log
Select-String -Path .github\prompts\db-refactor\logs\phase-9-05-jsonb-comment.log -Pattern "ADR-001"
# Expected: ≥ 1 hit
```

## Out of Scope

- Don't add comments to non-jsonb columns
- Don't wordsmith the existing comment if it already references ADR-001

## Commit When Done

```powershell
git add -f .github/prompts/db-refactor/logs/phase-9-05-jsonb-comment.log
# include any fix-up migration if you had to add the comment
git add migrations/
git commit -m "test(db-refactor): Phase 9.05 — sole jsonb carve-out documents ADR-001

automation_step_actions.command_params carries an ADR-001 reference
in pg_description. Future developers will see the rationale.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-001
- Phase 3 prompt 16 (carve-out)
