package database

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// retentionTable maps a retention configuration value to a TimescaleDB
// hypertable. Days = 0 means "retain forever" — any existing policy is
// removed, no new policy is created.
type retentionTable struct {
	Name string
	Days int
}

// ApplyRetentionPolicies adds or removes TimescaleDB drop_chunks retention
// policies based on the user's configuration. It is safe to call repeatedly
// at startup: existing policies are dropped and re-created so that interval
// changes take effect immediately. Continuous aggregates are not affected.
//
// Errors for individual tables are logged but do not abort the loop — a
// missing extension or non-hypertable table degrades gracefully.
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
				log.Warn().Err(err).Str("table", t.Name).Int("days", t.Days).
					Msg("retention policy not applied")
			}
		} else {
			if err := db.removeRetentionPolicy(ctx, t.Name); err != nil {
				log.Debug().Err(err).Str("table", t.Name).
					Msg("retention policy not removed (non-fatal)")
			}
		}
	}
	return nil
}

func (db *DB) addRetentionPolicy(ctx context.Context, table string, days int) error {
	// Drop any existing policy first so a changed interval takes effect.
	_ = db.removeRetentionPolicy(ctx, table)

	q := fmt.Sprintf(
		"SELECT add_retention_policy('%s', INTERVAL '%d days', if_not_exists => true)",
		table, days,
	)
	if _, err := db.Pool.Exec(ctx, q); err != nil {
		return fmt.Errorf("add retention policy %s: %w", table, err)
	}

	log.Info().Str("table", table).Int("days", days).
		Msg("retention policy active")
	return nil
}

func (db *DB) removeRetentionPolicy(ctx context.Context, table string) error {
	q := fmt.Sprintf(
		"SELECT remove_retention_policy('%s', if_exists => true)",
		table,
	)
	if _, err := db.Pool.Exec(ctx, q); err != nil {
		// Not a hypertable yet, or extension not installed — safe to ignore.
		return err
	}
	return nil
}
