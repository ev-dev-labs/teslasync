package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SecurityRepo persists security_events rows for the post-migration
// typed schema (migrations/000142_baseline_typed.up.sql).
type SecurityRepo struct {
	db *DB
}

func NewSecurityRepo(db *DB) *SecurityRepo {
	return &SecurityRepo{db: db}
}

// BulkInsert streams a batch of SecurityEvent rows into the
// security_events hypertable using pgx.CopyFrom for high-throughput
// telemetry ingest. Returns nil for empty input.
func (r *SecurityRepo) BulkInsert(ctx context.Context, es []models.SecurityEvent) error {
	if len(es) == 0 {
		return nil
	}
	rows := pgx.CopyFromSlice(len(es), func(i int) ([]any, error) {
		e := es[i]
		return []any{
			e.VehicleID,
			e.Ts,
			e.EventType,
			e.DoorsOpen,
			e.WindowsOpen,
			e.Locked,
			e.SentryMode,
			e.UserPresent,
			e.Detail,
			e.Source,
		}, nil
	})
	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"security_events"},
		[]string{
			"vehicle_id",
			"ts",
			"event_type",
			"doors_open",
			"windows_open",
			"locked",
			"sentry_mode",
			"user_present",
			"detail",
			"source",
		},
		rows,
	)
	if err != nil {
		return fmt.Errorf("security-repo-bulk-insert: %w", err)
	}
	return nil
}

// ListByVehicle returns security events for a vehicle within the
// inclusive [from, to] time window, ordered by timestamp ascending.
func (r *SecurityRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.SecurityEvent, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT vehicle_id, ts, event_type, doors_open, windows_open,
		       locked, sentry_mode, user_present, detail, source
		FROM security_events
		WHERE vehicle_id = $1 AND ts BETWEEN $2 AND $3
		ORDER BY ts`, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("security-repo-list-by-vehicle: %w", err)
	}
	defer rows.Close()

	var out []models.SecurityEvent
	for rows.Next() {
		var e models.SecurityEvent
		if err := rows.Scan(
			&e.VehicleID,
			&e.Ts,
			&e.EventType,
			&e.DoorsOpen,
			&e.WindowsOpen,
			&e.Locked,
			&e.SentryMode,
			&e.UserPresent,
			&e.Detail,
			&e.Source,
		); err != nil {
			return nil, fmt.Errorf("security-repo-list-by-vehicle: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("security-repo-list-by-vehicle: %w", err)
	}
	return out, nil
}
