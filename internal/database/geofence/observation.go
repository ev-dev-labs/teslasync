package geofence

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

type PlaceTransition struct {
	PlaceID   int64
	Name      string
	Direction string
}

type PlaceObservationRepo struct {
	db *database.DB
}

func NewPlaceObservationRepo(db *database.DB) *PlaceObservationRepo {
	return &PlaceObservationRepo{db: db}
}

// Observe serializes observations per vehicle and ignores replayed/older timestamps.
// A first fix establishes occupancy without generating spurious entries.
func (r *PlaceObservationRepo) Observe(ctx context.Context, vehicleID int64, at time.Time, lat, lng float64) ([]PlaceTransition, error) {
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat == 0 && lng == 0) || at.IsZero() {
		return nil, nil
	}
	var transitions []PlaceTransition
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var insertedID int64
		err := tx.QueryRow(ctx, `INSERT INTO place_alert_observation (vehicle_id, observed_at)
			VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING vehicle_id`, vehicleID, at).Scan(&insertedID)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		first := err == nil
		var previous time.Time
		if err := tx.QueryRow(ctx, `SELECT observed_at FROM place_alert_observation WHERE vehicle_id=$1 FOR UPDATE`, vehicleID).Scan(&previous); err != nil {
			return err
		}
		if !first && !at.After(previous) {
			return nil
		}
		matches, err := findActiveGeofencesNear(ctx, tx, lat, lng)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT place_id FROM place_alert_occupancy WHERE vehicle_id=$1`, vehicleID)
		if err != nil {
			return err
		}
		old := make(map[int64]bool)
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			old[id] = true
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		current := make(map[int64]bool)
		for _, place := range matches {
			if !place.Enabled {
				continue
			}
			current[place.ID] = true
			if !old[place.ID] && !first {
				transitions = append(transitions, PlaceTransition{place.ID, place.Name, "enter"})
			}
		}
		for id := range old {
			if !current[id] {
				// Retired/disabled places cannot produce a phantom exit.
				var name string
				var active bool
				if err := tx.QueryRow(ctx, `SELECT name, enabled AND archived_at IS NULL FROM geofences WHERE id=$1`, id).Scan(&name, &active); err != nil && err != pgx.ErrNoRows {
					return err
				}
				if active {
					transitions = append(transitions, PlaceTransition{id, name, "exit"})
				}
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM place_alert_occupancy WHERE vehicle_id=$1`, vehicleID); err != nil {
			return err
		}
		for id := range current {
			if _, err := tx.Exec(ctx, `INSERT INTO place_alert_occupancy(vehicle_id,place_id) VALUES ($1,$2)`, vehicleID, id); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE place_alert_observation SET observed_at=$2 WHERE vehicle_id=$1`, vehicleID, at)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("observe place occupancy for vehicle %d: %w", vehicleID, err)
	}
	return transitions, nil
}
