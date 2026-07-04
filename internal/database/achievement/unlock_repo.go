package achievement

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// unlockQuerier is the minimal pgx surface UnlockRepo needs. *pgxpool.Pool
// already satisfies it, so production wiring passes db.Pool through unchanged
// (no adapter layer, per the package doc). It is declared so unit tests can
// substitute a scripted fake without a live database — the codebase vendors no
// pgxmock/testcontainers harness (see guard_repo.go / trip/detail_repo.go for
// the same precedent).
type unlockQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Compile-time guard that *pgxpool.Pool still satisfies the narrow interface.
// If pgx renames Query/QueryRow this fails at build time rather than at
// runtime on the first request.
var _ unlockQuerier = (*pgxpool.Pool)(nil)

// UnlockRepo persists first-unlock timestamps for lifetime
// achievements. Used by the lifetime handler to detect locked → unlocked
// transitions and surface them as celebration events.
//
// vehicleID = 0 represents the fleet-wide (no vehicle filter) bucket so the
// (achievement_id, vehicle_id) primary key behaves correctly under standard
// UNIQUE semantics (no NULL-aware comparison required).
type UnlockRepo struct {
	q unlockQuerier
}

// NewUnlockRepo wires a repository against the shared pool. A nil db or nil
// pool at construction is a wiring bug, not a runtime condition, so we fail
// fast (mirrors NewGuardRepo / NewTripsDetailRepo / NewSignalsCatalogRepo)
// rather than deferring the nil-deref to the first query.
func NewUnlockRepo(db *database.DB) *UnlockRepo {
	if db == nil || db.Pool == nil {
		panic("achievement.NewUnlockRepo: db and db.Pool must not be nil")
	}
	return &UnlockRepo{q: db.Pool}
}

// Unlock is a single persisted unlock row.
type Unlock struct {
	AchievementID string
	VehicleID     int64
	UnlockedAt    time.Time
}

// listByVehicleSQL projects every persisted unlock for one vehicle scope.
// (achievement_id, vehicle_id) is the PRIMARY KEY (mig 000167) so the
// vehicle_id filter is served by an index range scan. vehicle_id = 0 is the
// fleet-wide bucket.
const listByVehicleSQL = `SELECT achievement_id, vehicle_id, unlocked_at
FROM achievement_unlocks
WHERE vehicle_id = $1`

// ListByVehicle returns every persisted unlock for the given vehicle scope.
// Pass vehicleID = 0 for the fleet-wide bucket.
func (r *UnlockRepo) ListByVehicle(ctx context.Context, vehicleID int64) ([]Unlock, error) {
	rows, err := r.q.Query(ctx, listByVehicleSQL, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("achievement_unlocks list: %w", err)
	}
	defer rows.Close()

	var out []Unlock
	for rows.Next() {
		var u Unlock
		if err := rows.Scan(&u.AchievementID, &u.VehicleID, &u.UnlockedAt); err != nil {
			return nil, fmt.Errorf("achievement_unlocks scan: %w", err)
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("achievement_unlocks rows: %w", err)
	}
	return out, nil
}

// recordUnlockSQL inserts a new unlock row if one does not already exist for
// the (achievement_id, vehicle_id) pair and reports, in a single round trip,
// whether the insert actually happened plus the persisted unlocked_at value.
//
// The data-modifying `ins` CTE and the UNION-ALL fallback SELECT run against
// the same snapshot: on a fresh insert the fallback SELECT cannot see the
// just-inserted row, so only the (TRUE, unlocked_at) branch yields a row; on
// a conflict the CTE returns nothing (DO NOTHING) and only the
// (FALSE, existing unlocked_at) branch yields a row. Either way exactly one
// row is returned, which QueryRow consumes.
const recordUnlockSQL = `WITH ins AS (
	INSERT INTO achievement_unlocks (achievement_id, vehicle_id, unlocked_at)
	VALUES ($1, $2, $3)
	ON CONFLICT (achievement_id, vehicle_id) DO NOTHING
	RETURNING unlocked_at
)
SELECT TRUE AS inserted, unlocked_at FROM ins
UNION ALL
SELECT FALSE AS inserted, unlocked_at
FROM achievement_unlocks
WHERE achievement_id = $1 AND vehicle_id = $2
LIMIT 1`

// RecordUnlock inserts a new unlock row if one does not already exist for the
// given (achievement_id, vehicle_id) pair. The returned bool is true when an
// insert actually happened (a fresh transition); false when the row already
// existed (idempotent re-evaluation). The returned timestamp is the persisted
// `unlocked_at` value in either case so callers can echo it back to clients.
//
// `when` is normalised to UTC before persistence so the stored timestamp is
// wall-clock-comparable regardless of the caller's location.
func (r *UnlockRepo) RecordUnlock(ctx context.Context, achievementID string, vehicleID int64, when time.Time) (bool, time.Time, error) {
	var inserted bool
	var unlockedAt time.Time
	err := r.q.QueryRow(ctx, recordUnlockSQL, achievementID, vehicleID, when.UTC()).
		Scan(&inserted, &unlockedAt)
	if err != nil {
		return false, time.Time{}, fmt.Errorf("achievement_unlocks record: %w", err)
	}
	return inserted, unlockedAt, nil
}
