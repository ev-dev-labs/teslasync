---
description: "Phase 5 - regenerate Go model for security_events"
---

# 🟢 Models 08 - Regenerate security_events model

> **Severity:** Standard | **Priority:** High | **Prompt #:** 8 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/models/security.go` |
| Depends on | `phase-4-migration/*` (schema applied) |
| Blocks | `phase-5-go-models/29-delete-eliminated-fields` |
| ADR refs | ADR-001, ADR-005 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Regenerate the `security_events` Go model so its fields, tags, and types match the migrated schema exactly. No `raw_json`, no JSONB except where ADR-005 carves an exception.

## What's Being Established

A canonical Go struct for `security_events` with `db:` and `json:` tags matching column names (snake_case). Nullable columns become pointer types. Time columns are `time.Time` or `*time.Time`. 

## Recommendation

```go
package models

// security_events mirrors the post-migration schema.
type SecurityEvents struct {
    VehicleID int64     `db:"vehicle_id" json:"vehicle_id"`
    Ts        time.Time `db:"ts" json:"ts"`
    EventKind string    `db:"event_kind" json:"event_kind"`
}
```

## Suggested Fix

1. Open `internal/models/security.go`.
2. Replace the struct definition with the regenerated one above.
3. Remove every field eliminated by Phase 3 (anything not in the new schema).
4. Ensure no `RawJSON map[string]any` or `Signals jsonb` style fields remain.
5. Keep helper methods (e.g. `IsActive()`) but update them if they referenced removed fields.

## Acceptance Criteria

- Struct fields 1-to-1 with `security_events` columns from Phase 3 schema.
- All nullable columns use pointer types.
- All `db:` and `json:` tags match column names exactly.
- No `raw_json`, no JSONB carve-outs unless ADR-005 explicitly allows.
- File compiles in isolation (`go build ./internal/models/...`).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/models/...
Select-String -Path internal/models/security.go -Pattern 'raw_json|RawJSON|jsonb' -SimpleMatch
```

## Out of Scope

Repository changes (covered in prompts 30-66). Migration changes (Phase 3/4).

## Commit When Done

```powershell
git add internal/models/security.go
git commit -m "phase-5(models): regenerate security_events model to match post-migration schema`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
