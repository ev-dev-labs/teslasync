package database

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// retentionTable maps a user config field to a hypertable name.
type retentionTable struct {
	Name string
	Days int
}

// ApplyRetentionPolicies installs or removes TimescaleDB retention policies
// on raw-data hypertables based on the user's configuration.
//
// Design:
//   - Days == 0  → remove any existing policy (retain forever — the default).
//   - Days  > 0  → add (or replace) an add_retention_policy for INTERVAL 'N days'.
//
// Retention policies only affect raw data; continuous aggregates are never
// touched here. Disabling a policy does NOT delete existing data — it simply
// stops future chunk drops.
//
// Non-hypertable tables (e.g. the native-partitioned `positions` table) are
// skipped with a debug log so the caller doesn't need to distinguish them.
// TimescaleDB must be installed for retention policies to be managed; if not,
// the function returns nil without error so development/CI on vanilla Postgres
// still works.
func (db *DB) ApplyRetentionPolicies(ctx context.Context, cfg config.RetentionConfig) error {
	var hasTimescale bool
	if err := db.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')`,
	).Scan(&hasTimescale); err != nil {
		log.Warn().Err(err).Msg("retention: failed to detect timescaledb extension")
		return nil
	}
	if !hasTimescale {
		log.Info().Msg("retention: timescaledb extension not installed — skipping policy management")
		return nil
	}

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
		isHyper, err := db.isHypertable(ctx, t.Name)
		if err != nil {
			log.Warn().Err(err).Str("table", t.Name).Msg("retention: hypertable check failed, skipping")
			continue
		}
		if !isHyper {
			log.Debug().Str("table", t.Name).Msg("retention: table is not a hypertable, skipping TimescaleDB policy")
			continue
		}

		if t.Days > 0 {
			if err := db.addRetentionPolicy(ctx, t.Name, t.Days); err != nil {
				// Non-fatal: log and continue with remaining tables.
				log.Error().Err(err).Str("table", t.Name).Int("days", t.Days).
					Msg("retention: failed to add policy")
			}
		} else {
			if err := db.removeRetentionPolicy(ctx, t.Name); err != nil {
				log.Debug().Err(err).Str("table", t.Name).Msg("retention: remove policy failed")
			}
		}
	}
	return nil
}

// isHypertable reports whether the given table in the public schema is a
// TimescaleDB hypertable.
func (db *DB) isHypertable(ctx context.Context, table string) (bool, error) {
	var exists bool
	err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM timescaledb_information.hypertables
			WHERE hypertable_schema = 'public' AND hypertable_name = $1
		)`, table).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (db *DB) addRetentionPolicy(ctx context.Context, table string, days int) error {
	// Remove any existing policy first so the interval can be changed across restarts.
	_ = db.removeRetentionPolicy(ctx, table)

	interval := fmt.Sprintf("%d days", days)
	// table comes from a hardcoded list in ApplyRetentionPolicies, not user input.
	query := fmt.Sprintf(
		"SELECT add_retention_policy('%s', INTERVAL '%s', if_not_exists => true)",
		table, interval,
	)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		return fmt.Errorf("add retention policy %s: %w", table, err)
	}

	log.Info().Str("table", table).Int("days", days).
		Msg("retention: policy active")
	return nil
}

func (db *DB) removeRetentionPolicy(ctx context.Context, table string) error {
	query := fmt.Sprintf(
		"SELECT remove_retention_policy('%s', if_exists => true)",
		table,
	)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		return err
	}
	log.Debug().Str("table", table).Msg("retention: policy removed (retain forever)")
	return nil
}
