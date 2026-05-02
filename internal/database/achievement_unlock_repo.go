package database

import (
	"context"
	"fmt"
	"time"
)

// AchievementUnlockRepo persists first-unlock timestamps for lifetime
// achievements. Used by the lifetime handler to detect locked → unlocked
// transitions and surface them as celebration events.
//
// vehicleID = 0 represents the fleet-wide (no vehicle filter) bucket so the
// (achievement_id, vehicle_id) primary key behaves correctly under standard
// UNIQUE semantics (no NULL-aware comparison required).
type AchievementUnlockRepo struct {
	db *DB
}

// NewAchievementUnlockRepo wires a repository against the shared pool.
func NewAchievementUnlockRepo(db *DB) *AchievementUnlockRepo {
	return &AchievementUnlockRepo{db: db}
}

// AchievementUnlock is a single persisted unlock row.
type AchievementUnlock struct {
	AchievementID string
	VehicleID     int64
	UnlockedAt    time.Time
}

// ListByVehicle returns every persisted unlock for the given vehicle scope.
// Pass vehicleID = 0 for the fleet-wide bucket.
func (r *AchievementUnlockRepo) ListByVehicle(ctx context.Context, vehicleID int64) ([]AchievementUnlock, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT achievement_id, vehicle_id, unlocked_at
		 FROM achievement_unlocks
		 WHERE vehicle_id = $1`,
		vehicleID,
	)
	if err != nil {
		return nil, fmt.Errorf("achievement_unlocks list: %w", err)
	}
	defer rows.Close()

	var out []AchievementUnlock
	for rows.Next() {
		var u AchievementUnlock
		if err := rows.Scan(&u.AchievementID, &u.VehicleID, &u.UnlockedAt); err != nil {
			return nil, fmt.Errorf("achievement_unlocks scan: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// RecordUnlock inserts a new unlock row if one does not already exist for the
// given (achievement_id, vehicle_id) pair. The returned bool is true when an
// insert actually happened (a fresh transition); false when the row already
// existed (idempotent re-evaluation). The returned timestamp is the persisted
// `unlocked_at` value in either case so callers can echo it back to clients.
func (r *AchievementUnlockRepo) RecordUnlock(ctx context.Context, achievementID string, vehicleID int64, when time.Time) (bool, time.Time, error) {
	var inserted bool
	var unlockedAt time.Time
	err := r.db.Pool.QueryRow(ctx,
		`WITH ins AS (
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
		 LIMIT 1`,
		achievementID, vehicleID, when.UTC(),
	).Scan(&inserted, &unlockedAt)
	if err != nil {
		return false, time.Time{}, fmt.Errorf("achievement_unlocks record: %w", err)
	}
	return inserted, unlockedAt, nil
}
