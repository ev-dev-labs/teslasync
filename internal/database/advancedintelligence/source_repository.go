// Package advancedintelligence implements bounded PostgreSQL adapters for
// advanced intelligence evidence and durable metadata.
package advancedintelligence

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	"github.com/jackc/pgx/v5"
)

type SourceRepository struct {
	q database.DBTX
}

func NewSourceRepository(db *database.DB) *SourceRepository {
	if db == nil || db.Pool == nil {
		panic("advancedintelligence.NewSourceRepository: db and db.Pool must not be nil")
	}
	return &SourceRepository{q: db.Pool}
}

func (r *SourceRepository) Calibration(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
) (*domain.CalibrationEvidence, error) {
	const query = `
		WITH drive_rollup AS (
			SELECT
				COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				)::int AS sample_count,
				SUM(distance_m) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				) AS distance_m,
				SUM(energy_used_wh) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				) AS energy_wh,
				SUM(energy_used_wh) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				) / NULLIF(SUM(distance_m) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				), 0) AS efficiency_wh_per_m,
				STDDEV_SAMP(energy_used_wh / NULLIF(distance_m, 0)) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				) AS efficiency_stddev_wh_per_m,
				AVG(ambient_temp_c_avg) FILTER (
					WHERE ended_at IS NOT NULL AND ambient_temp_c_avg IS NOT NULL
				) AS ambient_temp_c,
				MIN(started_at) AS first_observed_at,
				MAX(COALESCE(ended_at, started_at)) AS last_observed_at
			FROM drives
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		),
		charge_rollup AS (
			SELECT
				COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL
					  AND total_energy_added_wh > 0
					  AND delta_soc_pct >= 20
				)::int AS sample_count,
				AVG(total_energy_added_wh * 100.0 / NULLIF(delta_soc_pct, 0)) FILTER (
					WHERE ended_at IS NOT NULL
					  AND total_energy_added_wh > 0
					  AND delta_soc_pct >= 20
				) AS usable_battery_wh,
				MAX(COALESCE(ended_at, started_at)) AS last_observed_at
			FROM charging_sessions
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		)
		SELECT
			d.sample_count, c.sample_count, d.distance_m, d.energy_wh,
			d.efficiency_wh_per_m, d.efficiency_stddev_wh_per_m,
			c.usable_battery_wh, d.ambient_temp_c, d.first_observed_at,
			GREATEST(d.last_observed_at, c.last_observed_at)
		FROM drive_rollup d CROSS JOIN charge_rollup c`

	var evidence domain.CalibrationEvidence
	evidence.VehicleID = vehicleID
	if err := r.q.QueryRow(ctx, query, vehicleID, from.UTC(), to.UTC()).Scan(
		&evidence.DriveSampleCount,
		&evidence.ChargeSampleCount,
		&evidence.DistanceM,
		&evidence.EnergyUsedWh,
		&evidence.EfficiencyWhPerM,
		&evidence.EfficiencyStddevWhPerM,
		&evidence.UsableBatteryWh,
		&evidence.AmbientTempC,
		&evidence.FirstObservedAt,
		&evidence.LastObservedAt,
	); err != nil {
		return nil, fmt.Errorf("advanced intelligence calibration: %w", err)
	}
	return &evidence, nil
}

func (r *SourceRepository) FirmwareWindow(
	ctx context.Context,
	vehicleID int64,
	asOf time.Time,
) (*domain.FirmwareWindowEvidence, error) {
	const query = `
		WITH latest AS (
			SELECT su.version, COALESCE(su.installed_at, su.created_at) AS installed_at
			FROM software_updates su
			WHERE su.vehicle_id = $1
			  AND COALESCE(su.installed_at, su.created_at) < $2
			ORDER BY COALESCE(su.installed_at, su.created_at) DESC, su.id DESC
			LIMIT 1
		),
		target_model AS (
			SELECT model FROM vehicles WHERE id = $1
		),
		target AS (
			SELECT
				COUNT(*) FILTER (
					WHERE d.started_at >= l.installed_at - INTERVAL '14 days'
					  AND d.started_at < l.installed_at
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				)::int AS pre_count,
				COUNT(*) FILTER (
					WHERE d.started_at >= l.installed_at
					  AND d.started_at < LEAST($2, l.installed_at + INTERVAL '14 days')
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				)::int AS post_count,
				SUM(d.energy_used_wh) FILTER (
					WHERE d.started_at >= l.installed_at - INTERVAL '14 days'
					  AND d.started_at < l.installed_at
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				) / NULLIF(SUM(d.distance_m) FILTER (
					WHERE d.started_at >= l.installed_at - INTERVAL '14 days'
					  AND d.started_at < l.installed_at
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				), 0) AS pre_efficiency,
				SUM(d.energy_used_wh) FILTER (
					WHERE d.started_at >= l.installed_at
					  AND d.started_at < LEAST($2, l.installed_at + INTERVAL '14 days')
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				) / NULLIF(SUM(d.distance_m) FILTER (
					WHERE d.started_at >= l.installed_at
					  AND d.started_at < LEAST($2, l.installed_at + INTERVAL '14 days')
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				), 0) AS post_efficiency
			FROM latest l
			LEFT JOIN drives d ON d.vehicle_id = $1
		),
		peers AS (
			SELECT
				COUNT(*) FILTER (
					WHERE d.started_at >= l.installed_at - INTERVAL '14 days'
					  AND d.started_at < l.installed_at
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				)::int AS pre_count,
				COUNT(*) FILTER (
					WHERE d.started_at >= l.installed_at
					  AND d.started_at < LEAST($2, l.installed_at + INTERVAL '14 days')
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				)::int AS post_count,
				SUM(d.energy_used_wh) FILTER (
					WHERE d.started_at >= l.installed_at - INTERVAL '14 days'
					  AND d.started_at < l.installed_at
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				) / NULLIF(SUM(d.distance_m) FILTER (
					WHERE d.started_at >= l.installed_at - INTERVAL '14 days'
					  AND d.started_at < l.installed_at
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				), 0) AS pre_efficiency,
				SUM(d.energy_used_wh) FILTER (
					WHERE d.started_at >= l.installed_at
					  AND d.started_at < LEAST($2, l.installed_at + INTERVAL '14 days')
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				) / NULLIF(SUM(d.distance_m) FILTER (
					WHERE d.started_at >= l.installed_at
					  AND d.started_at < LEAST($2, l.installed_at + INTERVAL '14 days')
					  AND d.ended_at IS NOT NULL AND d.distance_m > 0 AND d.energy_used_wh > 0
				), 0) AS post_efficiency
			FROM latest l
			CROSS JOIN target_model tm
			LEFT JOIN vehicles v ON v.model = tm.model AND v.id <> $1
			LEFT JOIN drives d ON d.vehicle_id = v.id
		)
		SELECT
			l.version, l.installed_at,
			l.installed_at - INTERVAL '14 days', l.installed_at,
			l.installed_at, LEAST($2, l.installed_at + INTERVAL '14 days'),
			t.pre_count, t.post_count, p.pre_count, p.post_count,
			t.pre_efficiency, t.post_efficiency, p.pre_efficiency, p.post_efficiency
		FROM latest l CROSS JOIN target t CROSS JOIN peers p`

	var evidence domain.FirmwareWindowEvidence
	evidence.VehicleID = vehicleID
	err := r.q.QueryRow(ctx, query, vehicleID, asOf.UTC()).Scan(
		&evidence.Version,
		&evidence.InstalledAt,
		&evidence.PreStart,
		&evidence.PreEnd,
		&evidence.PostStart,
		&evidence.PostEnd,
		&evidence.PreDriveSampleCount,
		&evidence.PostDriveSampleCount,
		&evidence.PeerPreSampleCount,
		&evidence.PeerPostSampleCount,
		&evidence.PreEfficiencyWhPerM,
		&evidence.PostEfficiencyWhPerM,
		&evidence.PeerPreEfficiencyWhPerM,
		&evidence.PeerPostEfficiencyWhPerM,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("advanced intelligence firmware window: %w", err)
	}
	return &evidence, nil
}

func (r *SourceRepository) Survival(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
) (*domain.SurvivalEvidence, error) {
	const query = `
		WITH exposure AS (
			SELECT
				COUNT(*) FILTER (WHERE ended_at IS NOT NULL AND distance_m > 0)::int AS drive_count,
				SUM(distance_m) FILTER (WHERE ended_at IS NOT NULL AND distance_m > 0) AS distance_m,
				EXTRACT(EPOCH FROM (MAX(COALESCE(ended_at, started_at)) - MIN(started_at)))::bigint AS exposure_s,
				MAX(COALESCE(ended_at, started_at)) AS latest_at
			FROM drives
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		),
		work_orders AS (
			SELECT
				COUNT(*) FILTER (WHERE lower(title) LIKE '%tire%' OR lower(title) LIKE '%tyre%')::int AS tire_count,
				COUNT(*) FILTER (WHERE lower(title) LIKE '%brake%')::int AS brake_count,
				COUNT(*) FILTER (WHERE lower(title) LIKE '%battery%')::int AS battery_count,
				COUNT(*) FILTER (WHERE lower(title) LIKE '%charg%')::int AS charging_count,
				MAX(updated_at) AS latest_at
			FROM fleet_maintenance_work_orders
			WHERE vehicle_id = $1 AND created_at >= $2 AND created_at < $3
			  AND status <> 'cancelled'
		),
		charging AS (
			SELECT
				COUNT(*) FILTER (
					WHERE ended_at IS NULL AND started_at < $3 - INTERVAL '6 hours'
				)::int AS incomplete_count,
				MAX(COALESCE(ended_at, started_at)) AS latest_at
			FROM charging_sessions
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		)
		SELECT
			e.drive_count, e.distance_m, e.exposure_s,
			w.tire_count, w.brake_count, w.battery_count,
			w.charging_count + c.incomplete_count,
			GREATEST(e.latest_at, w.latest_at, c.latest_at)
		FROM exposure e CROSS JOIN work_orders w CROSS JOIN charging c`

	var evidence domain.SurvivalEvidence
	evidence.VehicleID = vehicleID
	if err := r.q.QueryRow(ctx, query, vehicleID, from.UTC(), to.UTC()).Scan(
		&evidence.DriveSampleCount,
		&evidence.ExposureDistanceM,
		&evidence.ExposureS,
		&evidence.TireEventCount,
		&evidence.BrakeEventCount,
		&evidence.BatteryEventCount,
		&evidence.ChargingSystemEventCount,
		&evidence.LatestObservedAt,
	); err != nil {
		return nil, fmt.Errorf("advanced intelligence survival evidence: %w", err)
	}
	return &evidence, nil
}

func (r *SourceRepository) ListHazardEvidence(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
	limit, offset int,
) ([]domain.HazardEvidence, int, error) {
	const query = `
		WITH located_events AS (
			SELECT
				se.event_type,
				se.ts,
				location.coarse_cell
			FROM security_events se
			LEFT JOIN LATERAL (
				SELECT concat(
					round(lat.float_value::numeric, 2)::text,
					':',
					round(lng.float_value::numeric, 2)::text
				) AS coarse_cell
				FROM signal_log lat
				JOIN signal_log lng
				  ON lng.vehicle_id = lat.vehicle_id
				 AND lng.ts = lat.ts
				 AND lng.field = 'LocationLongitude'
				 AND lng.float_value BETWEEN -180 AND 180
				WHERE lat.vehicle_id = se.vehicle_id
				  AND lat.field = 'LocationLatitude'
				  AND lat.float_value BETWEEN -90 AND 90
				  AND lat.ts <= se.ts
				  AND lat.ts >= se.ts - INTERVAL '15 minutes'
				ORDER BY lat.ts DESC
				LIMIT 1
			) location ON true
			WHERE se.vehicle_id = $1
			  AND se.ts >= $2 AND se.ts < $3
			  AND se.event_type IN ('crash_state', 'airbag_deployed')
			  AND lower(COALESCE(se.to_state, '')) NOT IN (
				  '', 'false', 'off', 'none', 'inactive'
			  )
		),
		clusters AS (
			SELECT
				event_type,
				CASE
					WHEN event_type = 'airbag_deployed' THEN 'critical'
					ELSE 'high'
				END AS severity,
				COUNT(*)::int AS observation_count,
				MAX(ts) AS last_seen,
				coarse_cell
			FROM located_events
			WHERE coarse_cell IS NOT NULL
			GROUP BY event_type, coarse_cell
		)
		SELECT
			event_type,
			severity,
			observation_count,
			last_seen,
			coarse_cell,
			COUNT(*) OVER()::int AS total
		FROM clusters
		ORDER BY last_seen DESC, event_type, coarse_cell
		LIMIT $4 OFFSET $5`
	rows, err := r.q.Query(ctx, query, vehicleID, from.UTC(), to.UTC(), limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("advanced intelligence hazard evidence: %w", err)
	}
	defer rows.Close()

	items := make([]domain.HazardEvidence, 0)
	total := 0
	for rows.Next() {
		var item domain.HazardEvidence
		if err := rows.Scan(
			&item.HazardType,
			&item.Severity,
			&item.ObservationCount,
			&item.LastSeen,
			&item.CoarseCell,
			&total,
		); err != nil {
			return nil, 0, fmt.Errorf("scan advanced intelligence hazard evidence: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate advanced intelligence hazard evidence: %w", err)
	}
	return items, total, nil
}

func (r *SourceRepository) Sentinel(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
) (*domain.SentinelEvidence, error) {
	const query = `
		WITH commands AS (
			SELECT
				COUNT(*)::int AS sample_count,
				COUNT(*) FILTER (WHERE status IN ('failed', 'timed_out'))::int AS failure_count,
				COUNT(*) FILTER (WHERE ts >= $3 - INTERVAL '24 hours')::int AS recent_count,
				COUNT(*) FILTER (
					WHERE ts >= $3 - INTERVAL '24 hours'
					  AND status IN ('failed', 'timed_out')
				)::int AS recent_failure_count,
				COUNT(*) FILTER (
					WHERE ts < $3 - INTERVAL '24 hours'
				)::int AS prior_count,
				COUNT(*) FILTER (
					WHERE ts < $3 - INTERVAL '24 hours'
					  AND status IN ('failed', 'timed_out')
				)::int AS prior_failure_count,
				COUNT(DISTINCT invoked_by) FILTER (
					WHERE ts >= $3 - INTERVAL '24 hours'
				)::int AS recent_identity_count,
				COUNT(DISTINCT invoked_by) FILTER (
					WHERE ts < $3 - INTERVAL '24 hours'
				)::int AS prior_identity_count,
				MAX(ts) AS latest_at
			FROM command_executions
			WHERE vehicle_id = $1 AND ts >= $2 AND ts < $3
		),
		command_bursts AS (
			SELECT COALESCE(MAX(command_count), 0)::int AS max_per_minute
			FROM (
				SELECT date_trunc('minute', ts), COUNT(*) AS command_count
				FROM command_executions
				WHERE vehicle_id = $1 AND ts >= $2 AND ts < $3
				GROUP BY date_trunc('minute', ts)
			) grouped
		),
		signal_minutes AS (
			SELECT DISTINCT time_bucket('5 minutes', ts) AS ts
			FROM signal_log
			WHERE vehicle_id = $1 AND ts >= $2 AND ts < $3
		),
		signal_gaps AS (
			SELECT
				COUNT(*)::int AS sample_count,
				MAX(EXTRACT(EPOCH FROM (ts - prior_ts)))::bigint AS max_gap_s,
				MAX(ts) AS latest_at
			FROM (
				SELECT ts, LAG(ts) OVER (ORDER BY ts) AS prior_ts
				FROM signal_minutes
			) ordered
		)
		SELECT
			c.sample_count, c.failure_count, c.recent_count,
			c.recent_failure_count, c.prior_count, c.prior_failure_count,
			b.max_per_minute, c.recent_identity_count, c.prior_identity_count,
			s.sample_count, s.max_gap_s, c.latest_at, s.latest_at
		FROM commands c CROSS JOIN command_bursts b CROSS JOIN signal_gaps s`

	var evidence domain.SentinelEvidence
	evidence.VehicleID = vehicleID
	if err := r.q.QueryRow(ctx, query, vehicleID, from.UTC(), to.UTC()).Scan(
		&evidence.CommandSampleCount,
		&evidence.CommandFailureCount,
		&evidence.RecentCommandCount,
		&evidence.RecentFailureCount,
		&evidence.PriorCommandCount,
		&evidence.PriorFailureCount,
		&evidence.MaxCommandsPerMinute,
		&evidence.RecentIdentityCount,
		&evidence.PriorIdentityCount,
		&evidence.TelemetrySampleCount,
		&evidence.MaxTelemetryGapS,
		&evidence.LatestCommandAt,
		&evidence.LatestTelemetryAt,
	); err != nil {
		return nil, fmt.Errorf("advanced intelligence sentinel evidence: %w", err)
	}
	return &evidence, nil
}

func (r *SourceRepository) ListChargingEvidence(
	ctx context.Context,
	vehicleID int64,
	limit, offset int,
) ([]domain.ChargingSessionEvidence, int, error) {
	const query = `
		SELECT
			id, started_at, ended_at, total_energy_added_wh, delta_soc_pct,
			CASE
				WHEN cost_decimal IS NULL THEN NULL
				ELSE ROUND(cost_decimal * 100)::bigint
			END AS recorded_cost_minor,
			NULLIF(btrim(cost_currency), '') AS currency,
			COUNT(*) OVER()::int AS total
		FROM charging_sessions
		WHERE vehicle_id = $1
		ORDER BY started_at DESC, id DESC
		LIMIT $2 OFFSET $3`
	rows, err := r.q.Query(ctx, query, vehicleID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("advanced intelligence charging evidence: %w", err)
	}
	defer rows.Close()

	items := make([]domain.ChargingSessionEvidence, 0)
	total := 0
	for rows.Next() {
		var item domain.ChargingSessionEvidence
		if err := rows.Scan(
			&item.SessionID,
			&item.StartedAt,
			&item.EndedAt,
			&item.VehicleEnergyWh,
			&item.DeltaSocPct,
			&item.RecordedCostMinor,
			&item.Currency,
			&total,
		); err != nil {
			return nil, 0, fmt.Errorf("scan advanced intelligence charging evidence: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate advanced intelligence charging evidence: %w", err)
	}
	return items, total, nil
}

func (r *SourceRepository) Readiness(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
) (*domain.ReadinessEvidence, error) {
	const query = `
		WITH charging AS (
			SELECT
				COUNT(*)::int AS sample_count,
				COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL AND total_energy_added_wh > 0
				)::int AS success_count,
				MAX(COALESCE(ended_at, started_at)) AS latest_at
			FROM charging_sessions
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		),
		maintenance AS (
			SELECT
				COUNT(*)::int AS sample_count,
				COUNT(*) FILTER (
					WHERE status IN ('open', 'scheduled', 'in_progress')
				)::int AS active_count,
				COUNT(*) FILTER (
					WHERE status IN ('open', 'scheduled', 'in_progress')
					  AND severity IN ('high', 'critical')
				)::int AS critical_count,
				MAX(updated_at) AS latest_at
			FROM fleet_maintenance_work_orders
			WHERE vehicle_id = $1
		),
		telemetry AS (
			SELECT MAX(ts) AS latest_at
			FROM signal_log
			WHERE vehicle_id = $1 AND ts >= $2 AND ts < $3
		)
		SELECT c.sample_count, c.success_count, c.latest_at,
		       m.sample_count, m.active_count, m.critical_count, m.latest_at,
		       t.latest_at
		FROM charging c CROSS JOIN maintenance m CROSS JOIN telemetry t`

	var evidence domain.ReadinessEvidence
	evidence.VehicleID = vehicleID
	if err := r.q.QueryRow(ctx, query, vehicleID, from.UTC(), to.UTC()).Scan(
		&evidence.ChargingSampleCount,
		&evidence.ChargingSuccessCount,
		&evidence.ChargingLatestAt,
		&evidence.MaintenanceSampleCount,
		&evidence.ActiveMaintenanceCount,
		&evidence.CriticalMaintenanceCount,
		&evidence.MaintenanceLatestAt,
		&evidence.LatestTelemetryAt,
	); err != nil {
		return nil, fmt.Errorf("advanced intelligence readiness evidence: %w", err)
	}
	return &evidence, nil
}

func (r *SourceRepository) LocalTrainingAggregate(
	ctx context.Context,
	vehicleID int64,
	from, to time.Time,
) (*domain.LocalTrainingAggregate, error) {
	calibration, err := r.Calibration(ctx, vehicleID, from, to)
	if err != nil {
		return nil, err
	}
	return &domain.LocalTrainingAggregate{
		SampleCount:  calibration.DriveSampleCount,
		MetricWhPerM: calibration.EfficiencyWhPerM,
		ObservedAt:   calibration.LastObservedAt,
	}, nil
}

func (r *SourceRepository) MetricWindow(
	ctx context.Context,
	vehicleID int64,
	metric domain.CausalMetric,
	from, to time.Time,
) (*domain.MetricWindowEvidence, error) {
	const query = `
		WITH drive_rollup AS (
			SELECT
				COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				)::int AS sample_count,
				SUM(energy_used_wh) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				) / NULLIF(SUM(distance_m) FILTER (
					WHERE ended_at IS NOT NULL AND distance_m > 0 AND energy_used_wh > 0
				), 0) AS efficiency_wh_per_m,
				AVG(avg_speed_mps) FILTER (
					WHERE ended_at IS NOT NULL AND avg_speed_mps >= 0
				) AS average_speed_mps,
				100.0 * COUNT(ambient_temp_c_avg) FILTER (
					WHERE ended_at IS NOT NULL
				) / NULLIF(COUNT(*) FILTER (WHERE ended_at IS NOT NULL), 0)
					AS confounder_coverage_pct,
				AVG(ambient_temp_c_avg) FILTER (
					WHERE ended_at IS NOT NULL AND ambient_temp_c_avg IS NOT NULL
				) AS ambient_temp_c
			FROM drives
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		),
		charge_rollup AS (
			SELECT
				COUNT(*)::int AS sample_count,
				100.0 * COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL AND total_energy_added_wh > 0
				) / NULLIF(COUNT(*), 0) AS success_pct
			FROM charging_sessions
			WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3
		)
		SELECT
			CASE WHEN $4 = 'charging_success_pct' THEN c.sample_count ELSE d.sample_count END,
			CASE
				WHEN $4 = 'drive_energy_wh_per_m' THEN d.efficiency_wh_per_m
				WHEN $4 = 'charging_success_pct' THEN c.success_pct
				WHEN $4 = 'average_speed_mps' THEN d.average_speed_mps
				ELSE NULL
			END,
			d.confounder_coverage_pct,
			d.ambient_temp_c
		FROM drive_rollup d CROSS JOIN charge_rollup c`

	var evidence domain.MetricWindowEvidence
	if err := r.q.QueryRow(
		ctx, query, vehicleID, from.UTC(), to.UTC(), string(metric),
	).Scan(
		&evidence.SampleCount,
		&evidence.MetricValue,
		&evidence.ConfounderCoveragePct,
		&evidence.AmbientTempC,
	); err != nil {
		return nil, fmt.Errorf("advanced intelligence causal metric window: %w", err)
	}
	return &evidence, nil
}

func (r *SourceRepository) TCO(
	ctx context.Context,
	vehicleID int64,
	currency string,
	from, to time.Time,
) (*domain.TCOEvidence, error) {
	const query = `
		WITH drive_rollup AS (
			SELECT
				COUNT(*) FILTER (WHERE ended_at IS NOT NULL AND distance_m > 0)::int AS sample_count,
				SUM(distance_m) FILTER (WHERE ended_at IS NOT NULL AND distance_m > 0) AS distance_m
			FROM drives
			WHERE vehicle_id = $1 AND started_at >= $3 AND started_at < $4
		),
		charge_rollup AS (
			SELECT
				COUNT(*) FILTER (
					WHERE lower(COALESCE(charger_type, '')) SIMILAR TO '%(wall|mobile|home)%'
				)::int AS home_count,
				COUNT(*) FILTER (
					WHERE lower(COALESCE(charger_type, '')) NOT SIMILAR TO '%(wall|mobile|home)%'
				)::int AS public_count,
				SUM(total_energy_added_wh) FILTER (
					WHERE lower(COALESCE(charger_type, '')) SIMILAR TO '%(wall|mobile|home)%'
				) AS home_energy_wh,
				SUM(total_energy_added_wh) FILTER (
					WHERE lower(COALESCE(charger_type, '')) NOT SIMILAR TO '%(wall|mobile|home)%'
				) AS public_energy_wh,
				ROUND(SUM(cost_decimal) FILTER (
					WHERE lower(COALESCE(charger_type, '')) SIMILAR TO '%(wall|mobile|home)%'
					  AND btrim(cost_currency) = $2
				) * 100)::bigint AS home_cost_minor,
				ROUND(SUM(cost_decimal) FILTER (
					WHERE lower(COALESCE(charger_type, '')) NOT SIMILAR TO '%(wall|mobile|home)%'
					  AND btrim(cost_currency) = $2
				) * 100)::bigint AS public_cost_minor,
				COUNT(*)::int AS sample_count,
				COUNT(*) FILTER (
					WHERE ended_at IS NOT NULL AND total_energy_added_wh > 0
				)::int AS success_count,
				MAX(COALESCE(ended_at, started_at)) AS latest_at
			FROM charging_sessions
			WHERE vehicle_id = $1 AND started_at >= $3 AND started_at < $4
		),
		maintenance AS (
			SELECT SUM(cost_minor) FILTER (WHERE currency = $2) AS cost_minor,
			       MAX(updated_at) AS latest_at
			FROM fleet_maintenance_work_orders
			WHERE vehicle_id = $1
			  AND status = 'completed'
			  AND updated_at >= $3 AND updated_at < $4
		)
		SELECT
			d.sample_count, d.distance_m,
			c.home_count, c.public_count, c.home_energy_wh, c.public_energy_wh,
			c.home_cost_minor, c.public_cost_minor, m.cost_minor,
			c.sample_count, c.success_count, GREATEST(c.latest_at, m.latest_at)
		FROM drive_rollup d CROSS JOIN charge_rollup c CROSS JOIN maintenance m`

	var evidence domain.TCOEvidence
	if err := r.q.QueryRow(
		ctx, query, vehicleID, currency, from.UTC(), to.UTC(),
	).Scan(
		&evidence.DriveSampleCount,
		&evidence.DistanceM,
		&evidence.HomeChargeSampleCount,
		&evidence.PublicChargeSampleCount,
		&evidence.HomeEnergyWh,
		&evidence.PublicEnergyWh,
		&evidence.HomeCostMinor,
		&evidence.PublicCostMinor,
		&evidence.MaintenanceCostMinor,
		&evidence.ChargingSampleCount,
		&evidence.ChargingSuccessCount,
		&evidence.ObservedAt,
	); err != nil {
		return nil, fmt.Errorf("advanced intelligence tco evidence: %w", err)
	}
	return &evidence, nil
}
