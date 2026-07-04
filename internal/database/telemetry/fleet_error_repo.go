package telemetry

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// errorQuerier is the minimal pgx surface TeslaFleetTelemetryErrorRepo needs.
// *pgxpool.Pool already satisfies it, so production wiring passes db.Pool
// through unchanged (no adapter layer). It is declared so unit tests can
// substitute a scripted fake without a live database — the codebase vendors
// no pgxmock/testcontainers harness (see achievement/unlock_repo.go for the
// same precedent).
type errorQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Compile-time guard that *pgxpool.Pool still satisfies the narrow interface.
// If pgx renames Query/Begin this fails at build time rather than at runtime
// on the first request.
var _ errorQuerier = (*pgxpool.Pool)(nil)

// Extracted SQL statements. Kept as package constants so a column/table/clause
// typo is caught by the SQL-shape tests at test time rather than at runtime.
const (
	selectActiveErrorVINsSQL = `SELECT id, vin, active, first_seen_at, last_seen_at, resolved_at
		FROM tesla_fleet_telemetry_error_vins
		WHERE active = TRUE
		ORDER BY last_seen_at DESC`

	upsertErrorVINSQL = `INSERT INTO tesla_fleet_telemetry_error_vins (vin, active, first_seen_at, last_seen_at)
			VALUES ($1, TRUE, $2, $2)
			ON CONFLICT (vin) DO UPDATE SET
				active = TRUE,
				last_seen_at = $2,
				resolved_at = NULL`

	// resolveAbsentVINsSQL marks every currently-active VIN that is NOT present
	// in the incoming list ($2) as resolved. `vin != ALL($2)` is true exactly
	// when vin is absent from the array.
	resolveAbsentVINsSQL = `UPDATE tesla_fleet_telemetry_error_vins
			 SET active = FALSE, resolved_at = $1
			 WHERE active = TRUE AND vin != ALL($2)`

	// resolveAllActiveVINsSQL marks every active VIN as resolved. Used when the
	// incoming list is empty (Tesla reports zero error VINs).
	resolveAllActiveVINsSQL = `UPDATE tesla_fleet_telemetry_error_vins
			 SET active = FALSE, resolved_at = $1
			 WHERE active = TRUE`

	selectErrorsByVINSQL = `SELECT id, vin, error_code, error_message, reported_at, tesla_updated_at, fetched_at
			FROM tesla_fleet_telemetry_errors
			WHERE vin = $1
			ORDER BY fetched_at DESC
			LIMIT $2 OFFSET $3`

	selectErrorsAllSQL = `SELECT id, vin, error_code, error_message, reported_at, tesla_updated_at, fetched_at
			FROM tesla_fleet_telemetry_errors
			ORDER BY fetched_at DESC
			LIMIT $1 OFFSET $2`

	upsertErrorSQL = `INSERT INTO tesla_fleet_telemetry_errors (vin, error_code, error_message, reported_at, tesla_updated_at, fetched_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (vin, error_code, reported_at) DO UPDATE SET
				error_message = EXCLUDED.error_message,
				tesla_updated_at = EXCLUDED.tesla_updated_at,
				fetched_at = EXCLUDED.fetched_at`
)

// Pagination bounds for GetErrors. A non-positive or oversized limit falls back
// to defaultErrorPageLimit; a negative offset is clamped to zero.
const (
	defaultErrorPageLimit = 100
	maxErrorPageLimit     = 500
)

// TeslaFleetTelemetryErrorRepo provides data access for fleet telemetry error records.
type TeslaFleetTelemetryErrorRepo struct {
	q errorQuerier
}

// NewTeslaFleetTelemetryErrorRepo creates a new repository. A nil db or nil
// pool at construction is a wiring bug, not a runtime condition, so we fail
// fast (mirrors achievement.NewUnlockRepo) rather than deferring the nil-deref
// to the first query.
func NewTeslaFleetTelemetryErrorRepo(db *database.DB) *TeslaFleetTelemetryErrorRepo {
	if db == nil || db.Pool == nil {
		panic("telemetry.NewTeslaFleetTelemetryErrorRepo: db and db.Pool must not be nil")
	}
	return &TeslaFleetTelemetryErrorRepo{q: db.Pool}
}

// clampErrorPage normalises the (limit, offset) pagination window: a
// non-positive or oversized limit collapses to defaultErrorPageLimit and a
// negative offset collapses to zero. Extracted so the boundary behaviour is
// unit-testable without a database round trip.
func clampErrorPage(limit, offset int) (int, int) {
	if limit <= 0 || limit > maxErrorPageLimit {
		limit = defaultErrorPageLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// GetActiveErrorVINs returns all VINs with currently active telemetry errors.
func (r *TeslaFleetTelemetryErrorRepo) GetActiveErrorVINs(ctx context.Context) ([]*telemetrymodel.TeslaFleetTelemetryErrorVIN, error) {
	rows, err := r.q.Query(ctx, selectActiveErrorVINsSQL)
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
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active error vins: %w", err)
	}
	return results, nil
}

// ReplaceErrorVINs upserts active VINs and marks absent VINs as resolved.
// VINs not in the incoming list are marked inactive with a resolved_at timestamp.
func (r *TeslaFleetTelemetryErrorRepo) ReplaceErrorVINs(ctx context.Context, vins []string) error {
	tx, err := r.q.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	now := time.Now().UTC()

	for _, vin := range vins {
		if _, err := tx.Exec(ctx, upsertErrorVINSQL, vin, now); err != nil {
			return fmt.Errorf("upsert error vin %s: %w", vin, err)
		}
	}

	// Mark VINs not in the incoming list as resolved. With an empty list every
	// active VIN is resolved.
	if len(vins) > 0 {
		_, err = tx.Exec(ctx, resolveAbsentVINsSQL, now, vins)
	} else {
		_, err = tx.Exec(ctx, resolveAllActiveVINsSQL, now)
	}
	if err != nil {
		return fmt.Errorf("mark resolved error vins: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit error vins: %w", err)
	}
	return nil
}

// GetErrors returns error logs optionally filtered by VIN, ordered by fetched_at descending.
func (r *TeslaFleetTelemetryErrorRepo) GetErrors(ctx context.Context, vin string, limit, offset int) ([]*telemetrymodel.TeslaFleetTelemetryError, error) {
	limit, offset = clampErrorPage(limit, offset)

	var query string
	var args []interface{}

	if vin != "" {
		query = selectErrorsByVINSQL
		args = []interface{}{vin, limit, offset}
	} else {
		query = selectErrorsAllSQL
		args = []interface{}{limit, offset}
	}

	rows, err := r.q.Query(ctx, query, args...)
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
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fleet telemetry errors: %w", err)
	}
	return results, nil
}

// UpsertErrors inserts error entries, upserting on (vin, error_code, reported_at).
// The returned count is the number of rows affected. Nil entries in the slice
// are skipped defensively so a malformed batch cannot nil-deref the writer.
func (r *TeslaFleetTelemetryErrorRepo) UpsertErrors(ctx context.Context, errors []*telemetrymodel.TeslaFleetTelemetryError) (int, error) {
	if len(errors) == 0 {
		return 0, nil
	}

	tx, err := r.q.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	inserted := 0
	for _, e := range errors {
		if e == nil {
			continue
		}
		tag, err := tx.Exec(ctx, upsertErrorSQL,
			e.VIN, e.ErrorCode, e.ErrorMessage, e.ReportedAt, e.TeslaUpdatedAt, e.FetchedAt,
		)
		if err != nil {
			return 0, fmt.Errorf("upsert fleet telemetry error: %w", err)
		}
		inserted += int(tag.RowsAffected())
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit fleet telemetry errors: %w", err)
	}
	return inserted, nil
}
