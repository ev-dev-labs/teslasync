---
description: "Phase 5 - implement ListBySession on ChargingTelemetryRepo"
---

# 🔵 Repos 56 - ChargingTelemetryRepo: ListBySession

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 56 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/charging_telemetry_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-5-go-models/67-build-models-package` |
| ADR refs | ADR-002 |
| Estimated effort | small (~15-30 min) |

## Single Goal

List telemetry samples for a charging session in time order.

## What's Being Established

A single method `ListBySession` on the existing repo struct in `internal/database/charging_telemetry_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *ChargingTelemetryRepo) ListBySession(ctx context.Context, sessionID int64) ([]models.ChargingTelemetry, error) {
    rows, err := r.pool.Query(ctx, `SELECT session_id, ts, power_kw, voltage, current FROM charging_telemetry WHERE session_id=$1 ORDER BY ts`, sessionID)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []models.ChargingTelemetry
    for rows.Next() {
        var t models.ChargingTelemetry
        if err := rows.Scan(&t.SessionID, &t.Ts, &t.PowerKw, &t.Voltage, &t.Current); err != nil { return nil, err }
        out = append(out, t)
    }
    return out, rows.Err()
}
```

## Suggested Fix

1. Open `internal/database/charging_telemetry_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `ListBySession` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("charging-telemetry-repo-list-by-session: %w", err)`.
5. 

## Acceptance Criteria

- Method `ListBySession` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/charging_telemetry_repo.go -Pattern 'ListBySession'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/charging_telemetry_repo.go
git commit -m "phase-5(repos): add ListBySession to chargingtelemetryrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
