package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// PositionRepo provides typed access to the post-refactor `positions`
// hypertable. ADR-001 (typed-by-default) eliminates the legacy
// `signals jsonb` column entirely; ADR-005 keeps source units (mph,
// meters) in the row and defers conversion to the API layer.
type PositionRepo struct {
	db *DB
}

func NewPositionRepo(db *DB) *PositionRepo {
	return &PositionRepo{db: db}
}

// BulkInsert streams positions into the `positions` hypertable using
// pgx.CopyFrom. This is the high-throughput write path used by Fleet
// Telemetry batch flushes; per-row Insert is intentionally not
// provided on the typed schema.
//
// Columns mirror models.Position exactly — no JSONB, no raw_json.
func (r *PositionRepo) BulkInsert(ctx context.Context, ps []models.Position) error {
	if len(ps) == 0 {
		return nil
	}

	rows := pgx.CopyFromSlice(len(ps), func(i int) ([]any, error) {
		p := ps[i]
		return []any{
			p.VehicleID,
			p.Ts,
			p.Latitude,
			p.Longitude,
			p.Heading,
			p.SpeedMph,
			p.ElevationM,
			p.GpsState,
			p.Source,
		}, nil
	})

	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"positions"},
		[]string{"vehicle_id", "ts", "latitude", "longitude", "heading", "speed_mph", "elevation_m", "gps_state", "source"},
		rows,
	)
	if err != nil {
		return fmt.Errorf("positions-repo-bulk-insert: %w", err)
	}
	return nil
}

// ListByVehicle returns positions for a vehicle within the inclusive
// time window [from, to], ordered chronologically. Uses the typed
// columns from ADR-001; no JSONB hydration required.
func (r *PositionRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.Position, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT vehicle_id, ts, latitude, longitude, heading, speed_mph, elevation_m, gps_state, source
		FROM positions
		WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3
		ORDER BY ts
	`, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("positions-repo-list-by-vehicle: %w", err)
	}
	defer rows.Close()

	var out []models.Position
	for rows.Next() {
		var p models.Position
		if err := rows.Scan(
			&p.VehicleID,
			&p.Ts,
			&p.Latitude,
			&p.Longitude,
			&p.Heading,
			&p.SpeedMph,
			&p.ElevationM,
			&p.GpsState,
			&p.Source,
		); err != nil {
			return nil, fmt.Errorf("positions-repo-list-by-vehicle: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("positions-repo-list-by-vehicle: %w", err)
	}
	return out, nil
}
