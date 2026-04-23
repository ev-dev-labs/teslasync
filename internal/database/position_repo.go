package database

import (
	"context"
	"fmt"

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
