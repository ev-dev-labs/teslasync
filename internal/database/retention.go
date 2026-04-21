package database

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/rs/zerolog/log"
)

// retentionTable maps a hypertable name to its retention in days.
// Days == 0 means "retain forever" (any existing policy is removed).
type retentionTable struct {
	Name string
	Days int
}

// ApplyRetentionPolicies adds or removes TimescaleDB retention policies based
// on the user's configuration. A value of 0 means forever — any existing
// policy for that hypertable is dropped. Continuous aggregates are never
// affected by raw-data retention policies.
//
// Safe to call at every startup: existing policies are recreated so that
// interval changes take effect, and missing hypertables are logged and
// skipped (e.g. on a fresh DB where migrations have not yet created the
// hypertables).
func (db *DB) ApplyRetentionPolicies(ctx context.Context, cfg config.RetentionConfig) error {
	tables := []retentionTable{
		{"positions", cfg.PositionsDays},
		{"charging_telemetry", cfg.ChargingTelemetryDays},
		{"climate_snapshots", cfg.ClimateSnapshotsDays},
		{"security_events", cfg.SecurityEventsDays},
		{"motor_snapshots", cfg.MotorSnapshotsDays},
		{"tire_pressure_snapshots", cfg.TirePressureDays},
		{"media_snapshots", cfg.MediaSnapshotsDays},
		{"safety_snapshots", cfg.SafetySnapshotsDays},
	}

	for _, t := range tables {
		if t.Days > 0 {
			if err := db.addRetentionPolicy(ctx, t.Name, t.Days); err != nil {
				return err
			}
		} else {
			db.removeRetentionPolicy(ctx, t.Name)
		}
	}
	return nil
}

func (db *DB) addRetentionPolicy(ctx context.Context, table string, days int) error {
	// Remove existing policy first so the interval can be updated on restart.
	db.removeRetentionPolicy(ctx, table)

	// Table name comes from a hardcoded list, not user input — safe to format.
	query := fmt.Sprintf(
		"SELECT add_retention_policy('%s', INTERVAL '%d days', if_not_exists => true)",
		table, days,
	)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		log.Error().Err(err).Str("table", table).Int("days", days).
			Msg("failed to add retention policy")
		return fmt.Errorf("add retention policy %s: %w", table, err)
	}

	log.Info().Str("table", table).Int("days", days).
		Msg("retention policy active")
	return nil
}

func (db *DB) removeRetentionPolicy(ctx context.Context, table string) {
	query := fmt.Sprintf(
		"SELECT remove_retention_policy('%s', if_exists => true)",
		table,
	)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		// Table may not be a hypertable yet, or policy doesn't exist — safe
		// to ignore. Log at debug for diagnosability.
		log.Debug().Err(err).Str("table", table).
			Msg("no retention policy to remove (safe to ignore)")
	}
}
