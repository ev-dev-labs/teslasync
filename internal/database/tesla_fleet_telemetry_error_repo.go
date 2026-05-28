package database

import (
	"context"
	"fmt"
	"time"

	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"
)

// TeslaFleetTelemetryErrorRepo provides data access for fleet telemetry error records.
type TeslaFleetTelemetryErrorRepo struct {
	db *DB
}

// NewTeslaFleetTelemetryErrorRepo creates a new repository.
func NewTeslaFleetTelemetryErrorRepo(db *DB) *TeslaFleetTelemetryErrorRepo {
	return &TeslaFleetTelemetryErrorRepo{db: db}
}

// GetActiveErrorVINs returns all VINs with currently active telemetry errors.
func (r *TeslaFleetTelemetryErrorRepo) GetActiveErrorVINs(ctx context.Context) ([]*telemetrymodel.TeslaFleetTelemetryErrorVIN, error) {
	query := `SELECT id, vin, active, first_seen_at, last_seen_at, resolved_at
		FROM tesla_fleet_telemetry_error_vins
		WHERE active = TRUE
		ORDER BY last_seen_at DESC`

	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query active error vins: %w", err)
	}
	defer rows.Close()

	var results []*telemetrymodel.TeslaFleetTelemetryErrorVIN
	for rows.Next() {
		v := &telemetrymodel.TeslaFleetTelemetryErrorVIN{}
		if err := rows.Scan(&v.ID, &v.VIN, &v.Active, &v.FirstSeenAt, &v.LastSeenAt, &v.ResolvedAt); err != nil {
			return nil, fmt.Errorf("scan error vin: %w", err)
		}
		results = append(results, v)
	}
	return results, rows.Err()
}

// ReplaceErrorVINs upserts active VINs and marks absent VINs as resolved.
// VINs not in the incoming list are marked inactive with a resolved_at timestamp.
func (r *TeslaFleetTelemetryErrorRepo) ReplaceErrorVINs(ctx context.Context, vins []string) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	now := time.Now().UTC()

	for _, vin := range vins {
		_, err := tx.Exec(ctx, `INSERT INTO tesla_fleet_telemetry_error_vins (vin, active, first_seen_at, last_seen_at)
			VALUES ($1, TRUE, $2, $2)
			ON CONFLICT (vin) DO UPDATE SET
				active = TRUE,
				last_seen_at = $2,
				resolved_at = NULL`,
			vin, now,
		)
		if err != nil {
			return fmt.Errorf("upsert error vin %s: %w", vin, err)
		}
	}

	// Mark VINs not in the incoming list as resolved
	if len(vins) > 0 {
		_, err = tx.Exec(ctx,
			`UPDATE tesla_fleet_telemetry_error_vins
			 SET active = FALSE, resolved_at = $1
			 WHERE active = TRUE AND vin != ALL($2)`,
			now, vins,
		)
	} else {
		_, err = tx.Exec(ctx,
			`UPDATE tesla_fleet_telemetry_error_vins
			 SET active = FALSE, resolved_at = $1
			 WHERE active = TRUE`,
			now,
		)
	}
	if err != nil {
		return fmt.Errorf("mark resolved error vins: %w", err)
	}

	return tx.Commit(ctx)
}

// GetErrors returns error logs optionally filtered by VIN, ordered by fetched_at descending.
func (r *TeslaFleetTelemetryErrorRepo) GetErrors(ctx context.Context, vin string, limit, offset int) ([]*telemetrymodel.TeslaFleetTelemetryError, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var query string
	var args []interface{}

	if vin != "" {
		query = `SELECT id, vin, error_code, error_message, reported_at, tesla_updated_at, fetched_at
			FROM tesla_fleet_telemetry_errors
			WHERE vin = $1
			ORDER BY fetched_at DESC
			LIMIT $2 OFFSET $3`
		args = []interface{}{vin, limit, offset}
	} else {
		query = `SELECT id, vin, error_code, error_message, reported_at, tesla_updated_at, fetched_at
			FROM tesla_fleet_telemetry_errors
			ORDER BY fetched_at DESC
			LIMIT $1 OFFSET $2`
		args = []interface{}{limit, offset}
	}

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query fleet telemetry errors: %w", err)
	}
	defer rows.Close()

	var results []*telemetrymodel.TeslaFleetTelemetryError
	for rows.Next() {
		e := &telemetrymodel.TeslaFleetTelemetryError{}
		if err := rows.Scan(&e.ID, &e.VIN, &e.ErrorCode, &e.ErrorMessage, &e.ReportedAt, &e.TeslaUpdatedAt, &e.FetchedAt); err != nil {
			return nil, fmt.Errorf("scan fleet telemetry error: %w", err)
		}
		results = append(results, e)
	}
	return results, rows.Err()
}

// UpsertErrors inserts error entries, skipping duplicates on (vin, error_code, reported_at).
func (r *TeslaFleetTelemetryErrorRepo) UpsertErrors(ctx context.Context, errors []*telemetrymodel.TeslaFleetTelemetryError) (int, error) {
	if len(errors) == 0 {
		return 0, nil
	}

	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	inserted := 0
	for _, e := range errors {
		tag, err := tx.Exec(ctx,
			`INSERT INTO tesla_fleet_telemetry_errors (vin, error_code, error_message, reported_at, tesla_updated_at, fetched_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (vin, error_code, reported_at) DO UPDATE SET
				error_message = EXCLUDED.error_message,
				tesla_updated_at = EXCLUDED.tesla_updated_at,
				fetched_at = EXCLUDED.fetched_at`,
			e.VIN, e.ErrorCode, e.ErrorMessage, e.ReportedAt, e.TeslaUpdatedAt, e.FetchedAt,
		)
		if err != nil {
			return 0, fmt.Errorf("upsert fleet telemetry error: %w", err)
		}
		inserted += int(tag.RowsAffected())
	}

	return inserted, tx.Commit(ctx)
}
