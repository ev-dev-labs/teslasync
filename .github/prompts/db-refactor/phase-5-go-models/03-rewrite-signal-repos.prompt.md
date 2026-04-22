---
description: "Phase 5 — Implement SignalObservationsRepo and SignalCatalogRepo (cold-signal storage)"
---

# 🔵 Models 03 — Signal Repos (Observations + Catalog)

> **Severity:** Architectural (the cold-signal write path) | **Priority:** Critical | **Prompt #:** 3 of 6

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output files | `internal/database/signal_observations_repo.go`, `internal/database/signal_catalog_repo.go` |
| Depends on | `01-regenerate-models`, `02-delete-eliminated-fields` |
| Blocks | Phase 6 telemetry handler |
| ADR refs | ADR-002 (signal storage model) |
| Estimated effort | medium (~half day) |

## Single Goal

Create two new repo files that own all reads/writes to `signal_observations` (the cold-signal hypertable) and `signal_catalog` (the signal-name registry).

## What's Being Established

Per ADR-002, every Fleet Telemetry signal name is upserted into `signal_catalog`. Hot signals also write to a typed snapshot column. Cold signals write only to `signal_observations`. This prompt builds the persistence layer for both halves.

## Recommendation

### `signal_observations_repo.go`

```go
package database

import (
    "context"
    "fmt"
    "time"

    "github.com/jackc/pgx/v5"
    "github.com/ev-dev-labs/teslasync/internal/models"
)

type SignalObservationsRepo struct{ db *DB }

func NewSignalObservationsRepo(db *DB) *SignalObservationsRepo { return &SignalObservationsRepo{db: db} }

// BulkInsert is the high-throughput path called by the telemetry handler.
// Uses pgx.CopyFrom for performance — Phase 2 spike showed 50k rows/s on the
// throwaway DB.
func (r *SignalObservationsRepo) BulkInsert(ctx context.Context, obs []models.SignalObservation) error {
    if len(obs) == 0 {
        return nil
    }
    rows := make([][]any, 0, len(obs))
    for _, o := range obs {
        rows = append(rows, []any{
            o.Ts, o.VehicleID, o.SignalID, o.SignalName,
            o.ValueNumeric, o.ValueText, o.ValueBool, o.Source,
        })
    }
    _, err := r.db.Pool.CopyFrom(ctx,
        pgx.Identifier{"signal_observations"},
        []string{"ts", "vehicle_id", "signal_id", "signal_name",
                 "value_numeric", "value_text", "value_bool", "source"},
        pgx.CopyFromRows(rows))
    if err != nil {
        return fmt.Errorf("signal_observations bulk insert (%d rows): %w", len(obs), err)
    }
    return nil
}

func (r *SignalObservationsRepo) QueryHistory(ctx context.Context,
    vehicleID int64, signalName string, since, until time.Time, limit int,
) ([]models.SignalObservation, error) {
    if limit <= 0 || limit > 10000 {
        limit = 1000
    }
    const q = `
      SELECT ts, vehicle_id, signal_id, signal_name,
             value_numeric, value_text, value_bool, source
        FROM signal_observations
       WHERE vehicle_id = $1 AND signal_name = $2 AND ts BETWEEN $3 AND $4
       ORDER BY ts DESC
       LIMIT $5`
    rows, err := r.db.Pool.Query(ctx, q, vehicleID, signalName, since, until, limit)
    if err != nil {
        return nil, fmt.Errorf("signal_observations query: %w", err)
    }
    defer rows.Close()
    var out []models.SignalObservation
    for rows.Next() {
        var o models.SignalObservation
        if err := rows.Scan(&o.Ts, &o.VehicleID, &o.SignalID, &o.SignalName,
            &o.ValueNumeric, &o.ValueText, &o.ValueBool, &o.Source); err != nil {
            return nil, fmt.Errorf("scan: %w", err)
        }
        out = append(out, o)
    }
    return out, rows.Err()
}

// QueryHourlyStats reads from cagg_signal_hourly (continuous aggregate from prompt 26).
func (r *SignalObservationsRepo) QueryHourlyStats(ctx context.Context,
    vehicleID int64, signalName string, since, until time.Time,
) ([]models.SignalHourlyStat, error) { /* ... */ }
```

### `signal_catalog_repo.go`

```go
package database

type SignalCatalogRepo struct{ db *DB }

func NewSignalCatalogRepo(db *DB) *SignalCatalogRepo { return &SignalCatalogRepo{db: db} }

// UpsertObserved bumps last_seen_at and observation_count for a signal name.
// Inserts the row at storage_tier='cold' if not present.
func (r *SignalCatalogRepo) UpsertObserved(ctx context.Context,
    name string, source models.SignalSource,
) (int64, error) {
    const q = `
      INSERT INTO signal_catalog (signal_name, first_seen_at, last_seen_at, observation_count, storage_tier)
      VALUES ($1, now(), now(), 1, 'cold')
      ON CONFLICT (signal_name) DO UPDATE
        SET last_seen_at = now(),
            observation_count = signal_catalog.observation_count + 1
      RETURNING id`
    var id int64
    if err := r.db.Pool.QueryRow(ctx, q, name).Scan(&id); err != nil {
        return 0, fmt.Errorf("signal_catalog upsert(%q): %w", name, err)
    }
    return id, nil
}

// BulkUpsertObserved batches the upsert for a whole telemetry batch.
// Returns name -> signal_id map for the caller to populate SignalObservation.SignalID.
func (r *SignalCatalogRepo) BulkUpsertObserved(ctx context.Context, names []string) (map[string]int64, error) {
    // Implementation: VALUES (...), (...), ... ON CONFLICT DO UPDATE RETURNING id, signal_name
}

func (r *SignalCatalogRepo) ListAll(ctx context.Context) ([]models.SignalCatalogEntry, error) { /* ... */ }
func (r *SignalCatalogRepo) GetByName(ctx context.Context, name string) (*models.SignalCatalogEntry, error) { /* ... */ }
func (r *SignalCatalogRepo) PromoteToHot(ctx context.Context, name, table, column string) error { /* ... */ }
```

## Suggested Fix

1. Write the two files
2. Wire into `cmd/teslasync/main.go` constructor (`NewSignalObservationsRepo(db)`, `NewSignalCatalogRepo(db)`)
3. Add minimal table-driven tests for `UpsertObserved` (insert-then-update path) and `QueryHistory` (range filter)
4. Build + run tests
5. Commit

## Acceptance Criteria

- [ ] Both files exist
- [ ] `BulkInsert` uses `pgx.CopyFrom` (NOT a per-row INSERT loop)
- [ ] `BulkUpsertObserved` does a single round-trip (NOT N upserts)
- [ ] `UpsertObserved` returns the `signal_id` (caller needs it for the FK on `signal_observations`)
- [ ] All public methods take `context.Context` first
- [ ] All errors wrapped with operation context
- [ ] `defer rows.Close()` on every Query
- [ ] Constructor wired in `cmd/teslasync/main.go`
- [ ] Tests for upsert insert-vs-update path pass
- [ ] `go build ./...` + `go test -race ./internal/database/...` exit 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./...
go test -race -count=1 ./internal/database/... -run 'TestSignal'

# Confirm CopyFrom usage (not per-row inserts)
Select-String -Path internal\database\signal_observations_repo.go -Pattern 'CopyFrom'
# Expected: at least 1 hit
```

## Out of Scope

- Don't write the telemetry handler integration here (Phase 6)
- Don't backfill `signal_catalog` from old `signals jsonb` data (won't exist post-cutover; staging will rebuild organically per ADR-009)
- Don't add a hot-signal promotion endpoint here — operator concern (Phase 10 soak deliverable)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/database/signal_observations_repo.go internal/database/signal_catalog_repo.go cmd/teslasync/main.go
git add internal/database/signal_observations_repo_test.go internal/database/signal_catalog_repo_test.go
git commit -m "repo(db-refactor): add SignalObservationsRepo and SignalCatalogRepo

ADR-002: cold-signal write path. CopyFrom-based bulk insert, batched
catalog upsert returning signal_id map. Wired into main.go.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
- `phase-3-schema/08-create-signal-observations-hypertable.prompt.md`
- `phase-3-schema/09-create-signal-catalog.prompt.md`
