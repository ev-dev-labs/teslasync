package database

import (
	"context"
	"fmt"

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
