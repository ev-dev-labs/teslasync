package database

import (
	"context"
	"fmt"

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
