---
description: "Phase 5 - implement BulkInsert on ChargingTelemetryRepo"
---

# 🔵 Repos 55 - ChargingTelemetryRepo: BulkInsert

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 55 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/charging_telemetry_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-5-go-models/67-build-models-package` |
| ADR refs | ADR-002 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Bulk-insert charging telemetry samples via `pgx.CopyFrom`.

## What's Being Established

A single method `BulkInsert` on the existing repo struct in `internal/database/charging_telemetry_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *ChargingTelemetryRepo) BulkInsert(ctx context.Context, ts []models.ChargingTelemetry) error {
    if len(ts) == 0 { return nil }
    rows := pgx.CopyFromSlice(len(ts), func(i int) ([]any, error) {
        t := ts[i]
        return []any{t.SessionID, t.Ts, t.PowerKw, t.Voltage, t.Current}, nil
    })
    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{"charging_telemetry"}, []string{"session_id","ts","power_kw","voltage","current"}, rows)
    if err != nil { return fmt.Errorf("charging telemetry bulk insert: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/charging_telemetry_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `BulkInsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("charging-telemetry-repo-bulk-insert: %w", err)`.
5. 

## Acceptance Criteria

- Method `BulkInsert` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/charging_telemetry_repo.go -Pattern 'BulkInsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/charging_telemetry_repo.go
git commit -m "phase-5(repos): add BulkInsert to chargingtelemetryrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
