package benchmark

import (
	"context"
	"errors"
	"fmt"
	"time"

	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
	"github.com/jackc/pgx/v5"
)

// SourceAggregates is an in-memory aggregate projection. It contains no raw
// session, trip, notification, command, location or VIN rows.
type SourceAggregates struct {
	CapacitySampleCount      int
	EarlyCapacityWh          *float64
	RecentCapacityWh         *float64
	DriveSampleCount         int
	DriveEnergyWh            *float64
	DriveDistanceM           *float64
	ChargingSampleCount      int
	ChargingSuccessCount     int
	NotificationSampleCount  int
	NotificationSuccessCount int
	CommandSampleCount       int
	CommandSuccessCount      int
}

// DeriveSourceAggregates reads only canonical aggregates/session tables. Every
// subquery is already grouped to one scalar; no raw source row crosses the repo
// boundary.
func (r *Repo) DeriveSourceAggregates(ctx context.Context, vehicleID int64, start, end time.Time) (*SourceAggregates, error) {
	const query = `
		WITH capacity_samples AS (
			SELECT
				bucket,
				(COALESCE(ac_energy_added_wh, 0) + COALESCE(dc_energy_added_wh, 0))
				/ NULLIF((max_soc - min_soc) / 100.0, 0) AS capacity_wh
			FROM cagg_battery_daily
			WHERE vehicle_id = $1
			  AND bucket >= $2
			  AND bucket < $3
			  AND max_soc IS NOT NULL
			  AND min_soc IS NOT NULL
			  AND (max_soc - min_soc) >= 20
			  AND (COALESCE(ac_energy_added_wh, 0) + COALESCE(dc_energy_added_wh, 0)) > 0
		),
		capacity_rollup AS (
			SELECT
				COUNT(*)::int AS sample_count,
				AVG(capacity_wh) FILTER (
					WHERE bucket < ($2::date + (($3::date - $2::date) / 2))
				) AS early_wh,
				AVG(capacity_wh) FILTER (
					WHERE bucket >= ($2::date + (($3::date - $2::date) / 2))
				) AS recent_wh
			FROM capacity_samples
		),
		drive_rollup AS (
			SELECT
				COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL
					  AND distance_m > 0
					  AND energy_used_wh >= 0
				)::int AS sample_count,
				SUM(energy_used_wh) FILTER (
					WHERE ended_at IS NOT NULL
					  AND distance_m > 0
					  AND energy_used_wh >= 0
				) AS energy_wh,
				SUM(distance_m) FILTER (
					WHERE ended_at IS NOT NULL
					  AND distance_m > 0
					  AND energy_used_wh >= 0
				) AS distance_m
			FROM drives
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		),
		charging_rollup AS (
			SELECT
				COUNT(*)::int AS sample_count,
				COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL AND total_energy_added_wh > 0
				)::int AS success_count
			FROM charging_sessions
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		),
		notification_rollup AS (
			SELECT
				COUNT(*)::int AS sample_count,
				COUNT(*) FILTER (WHERE delivery_status = 'delivered')::int AS success_count
			FROM notifications
			WHERE vehicle_id = $1 AND ts >= $2 AND ts < $3
		),
		command_rollup AS (
			SELECT
				COUNT(*)::int AS sample_count,
				COUNT(*) FILTER (WHERE status = 'succeeded')::int AS success_count
			FROM command_executions
			WHERE vehicle_id = $1 AND ts >= $2 AND ts < $3
		)
		SELECT
			c.sample_count, c.early_wh, c.recent_wh,
			d.sample_count, d.energy_wh, d.distance_m,
			ch.sample_count, ch.success_count,
			n.sample_count, n.success_count,
			cmd.sample_count, cmd.success_count
		FROM capacity_rollup c
		CROSS JOIN drive_rollup d
		CROSS JOIN charging_rollup ch
		CROSS JOIN notification_rollup n
		CROSS JOIN command_rollup cmd`

	var a SourceAggregates
	if err := r.q.QueryRow(ctx, query, vehicleID, start.UTC(), end.UTC()).Scan(
		&a.CapacitySampleCount, &a.EarlyCapacityWh, &a.RecentCapacityWh,
		&a.DriveSampleCount, &a.DriveEnergyWh, &a.DriveDistanceM,
		&a.ChargingSampleCount, &a.ChargingSuccessCount,
		&a.NotificationSampleCount, &a.NotificationSuccessCount,
		&a.CommandSampleCount, &a.CommandSuccessCount,
	); err != nil {
		return nil, fmt.Errorf("benchmark derive source aggregates: %w", err)
	}
	return &a, nil
}

const contributionColumns = `id, consent_id, period_start, period_end,
	model_family, model_year_bucket,
	degradation_pct, efficiency_wh_per_km, charging_reliability_pct,
	operation_reliability_pct,
	degradation_sample_count, efficiency_sample_count,
	charging_sample_count, operation_sample_count,
	mechanism_version, created_at`

func scanContribution(row pgx.Row) (*models.PrivacyBenchmarkContribution, error) {
	var c models.PrivacyBenchmarkContribution
	if err := row.Scan(
		&c.ID, &c.ConsentID, &c.PeriodStart, &c.PeriodEnd,
		&c.ModelFamily, &c.ModelYearBucket,
		&c.DegradationPct, &c.EfficiencyWhPerKm, &c.ChargingReliabilityPct,
		&c.OperationReliabilityPct,
		&c.DegradationSampleCount, &c.EfficiencySampleCount,
		&c.ChargingSampleCount, &c.OperationSampleCount,
		&c.MechanismVersion, &c.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repo) GetContribution(
	ctx context.Context,
	consentID int64,
	start, end time.Time,
	mechanismVersion int16,
) (*models.PrivacyBenchmarkContribution, error) {
	c, err := scanContribution(r.q.QueryRow(ctx, `
		SELECT `+contributionColumns+`
		FROM privacy_benchmark_contributions
		WHERE consent_id = $1
		  AND period_start = $2
		  AND period_end = $3
		  AND mechanism_version = $4`,
		consentID, start.UTC(), end.UTC(), mechanismVersion,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("benchmark contribution get: %w", err)
	}
	return c, nil
}

func (r *Repo) InsertContribution(ctx context.Context, c *models.PrivacyBenchmarkContribution) (*models.PrivacyBenchmarkContribution, error) {
	if c == nil {
		return nil, errors.New("benchmark contribution insert: nil contribution")
	}
	row := r.q.QueryRow(ctx, `
		INSERT INTO privacy_benchmark_contributions (
			consent_id, period_start, period_end, model_family, model_year_bucket,
			degradation_pct, efficiency_wh_per_km, charging_reliability_pct,
			operation_reliability_pct,
			degradation_sample_count, efficiency_sample_count,
			charging_sample_count, operation_sample_count, mechanism_version
		)
		VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9,
			$10, $11, $12, $13, $14
		)
		ON CONFLICT (consent_id, period_start, period_end, mechanism_version)
		DO UPDATE SET consent_id = EXCLUDED.consent_id
		RETURNING `+contributionColumns,
		c.ConsentID, c.PeriodStart.UTC(), c.PeriodEnd.UTC(), c.ModelFamily, c.ModelYearBucket,
		c.DegradationPct, c.EfficiencyWhPerKm, c.ChargingReliabilityPct,
		c.OperationReliabilityPct,
		c.DegradationSampleCount, c.EfficiencySampleCount,
		c.ChargingSampleCount, c.OperationSampleCount, c.MechanismVersion,
	)
	out, err := scanContribution(row)
	if err != nil {
		return nil, fmt.Errorf("benchmark contribution insert: %w", err)
	}
	return out, nil
}
