package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SignalObservationRepo provides data access for the cold-path
// signal_observations tall table (ADR-002 hot/cold split).
type SignalObservationRepo struct {
	db *DB
}

// NewSignalObservationRepo constructs a SignalObservationRepo bound to db.
func NewSignalObservationRepo(db *DB) *SignalObservationRepo {
	return &SignalObservationRepo{db: db}
}

// BulkInsert ingests a batch of signal observations using pgx.CopyFrom for
// high-throughput telemetry writes (ADR-001). Caller is responsible for
// ensuring every signal_name exists in signal_catalog (FK is RESTRICT per
// ADR-009 onboarding ritual).
func (r *SignalObservationRepo) BulkInsert(ctx context.Context, obs []models.SignalObservation) error {
	if len(obs) == 0 {
		return nil
	}

	rows := pgx.CopyFromSlice(len(obs), func(i int) ([]any, error) {
		o := obs[i]
		source := o.Source
		if source == "" {
			source = "fleet_telemetry"
		}
		return []any{
			o.VehicleID,
			o.Ts,
			o.SignalName,
			o.ValueNumeric,
			o.ValueText,
			o.ValueBool,
			source,
		}, nil
	})

	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"signal_observations"},
		[]string{"vehicle_id", "ts", "signal_name", "value_numeric", "value_text", "value_bool", "source"},
		rows,
	)
	if err != nil {
		return fmt.Errorf("signal-observations-repo-bulk-insert: %w", err)
	}
	return nil
}

// ListByVehicle returns signal observations for a vehicle within the inclusive
// time window [from, to], ordered by ts ASC and capped by limit.
func (r *SignalObservationRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time, limit int) ([]models.SignalObservation, error) {
	const query = `
		SELECT vehicle_id, ts, signal_name, value_numeric, value_text, value_bool, source
		FROM signal_observations
		WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3
		ORDER BY ts ASC
		LIMIT $4`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("signal-observations-repo-list-by-vehicle: %w", err)
	}
	defer rows.Close()

	out := make([]models.SignalObservation, 0)
	for rows.Next() {
		var o models.SignalObservation
		if err := rows.Scan(
			&o.VehicleID,
			&o.Ts,
			&o.SignalName,
			&o.ValueNumeric,
			&o.ValueText,
			&o.ValueBool,
			&o.Source,
		); err != nil {
			return nil, fmt.Errorf("signal-observations-repo-list-by-vehicle-scan: %w", err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("signal-observations-repo-list-by-vehicle-rows: %w", err)
	}
	return out, nil
}
