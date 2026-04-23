---
description: "Phase 5 - regenerate Go model for charging_sessions"
---

# 🟢 Models 03 - Regenerate charging_sessions model

> **Severity:** Standard | **Priority:** High | **Prompt #:** 3 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/models/charging.go` |
| Depends on | `phase-4-migration/*` (schema applied) |
| Blocks | `phase-5-go-models/29-delete-eliminated-fields` |
| ADR refs | ADR-001, ADR-005 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Regenerate the `charging_sessions` Go model so its fields, tags, and types match the migrated schema exactly. No `raw_json`, no JSONB except where ADR-005 carves an exception.

## What's Being Established

A canonical Go struct for `charging_sessions` with `db:` and `json:` tags matching column names (snake_case). Nullable columns become pointer types. Time columns are `time.Time` or `*time.Time`. 

## Recommendation

```go
package models

// charging_sessions mirrors the post-migration schema.
type ChargingSessions struct {
    ID        int64      `db:"id" json:"id"`
    VehicleID int64      `db:"vehicle_id" json:"vehicle_id"`
    StartTs   time.Time  `db:"start_ts" json:"start_ts"`
    EndTs     *time.Time `db:"end_ts" json:"end_ts"`
    EnergyKwh *float64   `db:"energy_kwh" json:"energy_kwh"`
}
```

## Suggested Fix

1. Open `internal/models/charging.go`.
2. Replace the struct definition with the regenerated one above.
3. Remove every field eliminated by Phase 3 (anything not in the new schema).
4. Ensure no `RawJSON map[string]any` or `Signals jsonb` style fields remain.
5. Keep helper methods (e.g. `IsActive()`) but update them if they referenced removed fields.

## Acceptance Criteria

- Struct fields 1-to-1 with `charging_sessions` columns from Phase 3 schema.
- All nullable columns use pointer types.
- All `db:` and `json:` tags match column names exactly.
- No `raw_json`, no JSONB carve-outs unless ADR-005 explicitly allows.
- File compiles in isolation (`go build ./internal/models/...`).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/models/...
Select-String -Path internal/models/charging.go -Pattern 'raw_json|RawJSON|jsonb' -SimpleMatch
```

## Out of Scope

Repository changes (covered in prompts 30-66). Migration changes (Phase 3/4).

## Commit When Done

```powershell
git add internal/models/charging.go
git commit -m "phase-5(models): regenerate charging_sessions model to match post-migration schema`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
