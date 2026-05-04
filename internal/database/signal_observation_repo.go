package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SignalObservationRepo provides data access for the cold-path
// signal_observations tall table (ADR-002 hot/cold split).
type SignalObservationRepo struct {
	db *DB
}

// buildObservationQuery composes the SELECT for ListByVehicle / ListByName.
// signalName == "" omits the signal_name predicate. from.IsZero() omits the
// lower time bound. to.IsZero() omits the upper time bound. ORDER BY is
// always ts DESC (newest first) so callers reading data[0] get the latest
// observation. The returned args slice is positional and matches the $N
// placeholders in the query string.
func buildObservationQuery(vehicleID int64, signalName string, from, to time.Time, limit int) (string, []any) {
	args := []any{vehicleID}
	var b strings.Builder
	b.WriteString(`SELECT vehicle_id, ts, signal_name, value_numeric, value_text, value_bool, source
		FROM signal_observations
		WHERE vehicle_id = $1`)

	if signalName != "" {
		args = append(args, signalName)
		fmt.Fprintf(&b, ` AND signal_name = $%d`, len(args))
	}
	if !from.IsZero() {
		args = append(args, from)
		fmt.Fprintf(&b, ` AND ts >= $%d`, len(args))
	}
	if !to.IsZero() {
		args = append(args, to)
		fmt.Fprintf(&b, ` AND ts <= $%d`, len(args))
	}

	args = append(args, limit)
	fmt.Fprintf(&b, ` ORDER BY ts DESC LIMIT $%d`, len(args))
	return b.String(), args
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

// GetLatest returns the most recent observation for a (vehicle, signal_name)
// pair. Returns (nil, nil) when no observation exists.
func (r *SignalObservationRepo) GetLatest(ctx context.Context, vehicleID int64, signalName string) (*models.SignalObservation, error) {
	const query = `
		SELECT vehicle_id, ts, signal_name, value_numeric, value_text, value_bool, source
		FROM signal_observations
		WHERE vehicle_id = $1 AND signal_name = $2
		ORDER BY ts DESC
		LIMIT 1`

	var o models.SignalObservation
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, signalName).Scan(
		&o.VehicleID,
		&o.Ts,
		&o.SignalName,
		&o.ValueNumeric,
		&o.ValueText,
		&o.ValueBool,
		&o.Source,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("signal-observations-repo-get-latest: %w", err)
	}
	return &o, nil
}

// ListByVehicle returns signal observations for a vehicle, ordered most
// recent first (ts DESC) and capped by limit. Time bounds [from, to] are
// applied only when non-zero; passing time.Time{} for either bound omits
// that side of the predicate so callers can request "the latest N
// observations regardless of age" (used by the cold-signal panels on
// /driving-dynamics, the SignalLogWidget event feed, etc.).
//
// DESC ordering matches the frontend `latestNumeric()` helper which reads
// `data[0]` as "most recent". Switching from ASC to DESC also exploits
// the (vehicle_id, signal_name, ts DESC) compression order so the
// hypertable can satisfy LIMIT-bounded scans without an extra sort.
func (r *SignalObservationRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time, limit int) ([]models.SignalObservation, error) {
	query, args := buildObservationQuery(vehicleID, "", from, to, limit)

	rows, err := r.db.Pool.Query(ctx, query, args...)
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

// ListByName returns signal observations for a vehicle filtered by signal
// name, ordered most recent first (ts DESC) and capped by limit. Time bounds
// [from, to] are applied only when non-zero; passing time.Time{} for either
// bound omits that side of the predicate. signal_name is the FK into
// signal_catalog.name (ADR-009), so an explicit join is unnecessary for
// filtering.
//
// The (vehicle_id, signal_name, ts DESC) idx_signal_obs_vehicle_signal_ts
// index serves this query in index-only fashion for any limit.
func (r *SignalObservationRepo) ListByName(ctx context.Context, vehicleID int64, name string, from, to time.Time, limit int) ([]models.SignalObservation, error) {
	query, args := buildObservationQuery(vehicleID, name, from, to, limit)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("signal-observations-repo-list-by-name: %w", err)
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
			return nil, fmt.Errorf("signal-observations-repo-list-by-name-scan: %w", err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("signal-observations-repo-list-by-name-rows: %w", err)
	}
	return out, nil
}

// DeleteOlderThan removes observations strictly older than cutoff and
// returns the number of rows deleted. Used by the cold-storage retention
// worker (ADR-001).
func (r *SignalObservationRepo) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM signal_observations WHERE ts < $1`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("signal-observations-repo-delete-older-than: %w", err)
	}
	return tag.RowsAffected(), nil
}
