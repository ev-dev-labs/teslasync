---
description: "Phase 5 - purge raw_json, signals jsonb, and dropped snapshot columns"
---

# 🟡 Cleanup 29 - Delete eliminated fields across all models

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 29 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/models/*.go` |
| Depends on | `phase-5-go-models/01-28` |
| Blocks | `phase-5-go-models/30-66` |
| ADR refs | ADR-001, ADR-002, ADR-005 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Remove every Go field that no longer maps to a column in the post-migration schema. Specifically: `RawJSON`, `Signals jsonb`, and any per-snapshot `Signals map` fields.

## What's Being Established

A clean models package with no references to eliminated fields. `grep` for `raw_json|RawJSON|jsonb` returns only the documented ADR-005 carve-out (`AutomationStepActionCommand.CommandParams`).

## Recommendation

Run a project-wide search:

```powershell
Select-String -Path internal/models/*.go -Pattern 'raw_json|RawJSON|Signals\s+map|jsonb' -SimpleMatch
```

Delete every match except `command_params` on `AutomationStepActionCommand`.

## Suggested Fix

1. Run the search above.
2. For each hit, delete the field from the struct and any helper method that referenced it.
3. Confirm `go build ./internal/models/...` still passes.
4. Confirm the only remaining match is the ADR-005 carve-out.

## Acceptance Criteria

- `go build ./internal/models/...` passes.
- `Select-String` returns at most 1 hit (`AutomationStepActionCommand.CommandParams`).
- No struct field maps to a dropped column.

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/models/...
$hits = Select-String -Path internal/models/*.go -Pattern 'raw_json|RawJSON|Signals\s+map|jsonb' -SimpleMatch
$hits | Where-Object { $_.Line -notmatch 'command_params|CommandParams' }
```

## Out of Scope

Database/repo cleanup (covered in Phase 4 + repo prompts).

## Commit When Done

```powershell
git add internal/models/
git commit -m "phase-5(cleanup): purge raw_json and jsonb fields from models (ADR-005)`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
