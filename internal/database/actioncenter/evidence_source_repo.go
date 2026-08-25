package actioncenter

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
)

const latestBatteryHealthQuery = `
	WITH latest AS (
		SELECT DISTINCT ON (ledger.vehicle_id)
		       ledger.id, ledger.vehicle_id, v.display_name, ledger.soh_pct,
		       ledger.equivalent_full_cycles, ledger.issued_at
		FROM tesla_battery_passport_ledger ledger
		JOIN vehicles v ON v.id = ledger.vehicle_id
		WHERE ledger.soh_pct IS NOT NULL
		  AND ledger.soh_pct > 0
		  AND v.archived_at IS NULL
		  AND ($1::bigint IS NULL OR ledger.vehicle_id = $1)
		ORDER BY ledger.vehicle_id, ledger.issued_at DESC, ledger.id DESC
	)
	SELECT id, vehicle_id, display_name, soh_pct,
	       equivalent_full_cycles, issued_at
	FROM latest
	ORDER BY soh_pct ASC, issued_at DESC
	LIMIT $2`

func (r *SourceRepository) ListLatestBatteryHealth(
	ctx context.Context,
	vehicleID *int64,
	limit int,
) ([]domain.BatteryHealthRecord, error) {
	rows, err := r.q.Query(ctx, latestBatteryHealthQuery, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("list action center battery health: %w", err)
	}
	defer rows.Close()

	items := make([]domain.BatteryHealthRecord, 0)
	for rows.Next() {
		var item domain.BatteryHealthRecord
		if err := rows.Scan(
			&item.LedgerID,
			&item.Vehicle.ID,
			&item.Vehicle.DisplayName,
			&item.SohPct,
			&item.EquivalentFullCycles,
			&item.IssuedAt,
		); err != nil {
			return nil, fmt.Errorf("scan action center battery health: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center battery health: %w", err)
	}
	return items, nil
}

const driveEfficiencyEvidenceQuery = `
	WITH measured AS (
		SELECT d.id, d.vehicle_id, v.display_name, d.started_at, d.ended_at,
		       d.distance_m, d.energy_used_wh,
		       d.energy_used_wh / NULLIF(d.distance_m, 0) AS energy_intensity_wh_per_m
		FROM drives d
		JOIN vehicles v ON v.id = d.vehicle_id
		WHERE d.ended_at IS NOT NULL
		  AND d.started_at >= $1
		  AND d.distance_m >= 5000
		  AND d.energy_used_wh > 0
		  AND v.archived_at IS NULL
		  AND ($3::bigint IS NULL OR d.vehicle_id = $3)
	),
	baselines AS (
		SELECT vehicle_id,
		       AVG(energy_intensity_wh_per_m) AS baseline_wh_per_m,
		       COUNT(*)::bigint AS sample_count
		FROM measured
		GROUP BY vehicle_id
	)
	SELECT measured.id, measured.vehicle_id, measured.display_name,
	       measured.started_at, measured.ended_at, measured.distance_m,
	       measured.energy_used_wh, measured.energy_intensity_wh_per_m,
	       baselines.baseline_wh_per_m, baselines.sample_count,
	       measured.energy_intensity_wh_per_m / NULLIF(baselines.baseline_wh_per_m, 0),
	       GREATEST(
		       measured.energy_used_wh - (baselines.baseline_wh_per_m * measured.distance_m),
		       0
	       )
	FROM measured
	JOIN baselines USING (vehicle_id)
	WHERE measured.started_at >= $2
	  AND baselines.sample_count >= $4
	  AND measured.energy_intensity_wh_per_m >= baselines.baseline_wh_per_m * $5
	  AND measured.energy_intensity_wh_per_m >= $6
	ORDER BY measured.started_at DESC, measured.id DESC
	LIMIT $7`

func (r *SourceRepository) ListDriveEfficiencyEvidence(
	ctx context.Context,
	vehicleID *int64,
	baselineSince, findingSince time.Time,
	minimumSamples int,
	minimumRatio, minimumWhPerM float64,
	limit int,
) ([]domain.DriveEfficiencyRecord, error) {
	rows, err := r.q.Query(
		ctx,
		driveEfficiencyEvidenceQuery,
		baselineSince,
		findingSince,
		vehicleID,
		minimumSamples,
		minimumRatio,
		minimumWhPerM,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list action center drive efficiency evidence: %w", err)
	}
	defer rows.Close()

	items := make([]domain.DriveEfficiencyRecord, 0)
	for rows.Next() {
		var item domain.DriveEfficiencyRecord
		if err := rows.Scan(
			&item.DriveID,
			&item.Vehicle.ID,
			&item.Vehicle.DisplayName,
			&item.StartedAt,
			&item.EndedAt,
			&item.DistanceM,
			&item.EnergyUsedWh,
			&item.EnergyIntensityWhPerM,
			&item.BaselineWhPerM,
			&item.BaselineSampleCount,
			&item.IntensityRatio,
			&item.ExcessEnergyWh,
		); err != nil {
			return nil, fmt.Errorf("scan action center drive efficiency evidence: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center drive efficiency evidence: %w", err)
	}
	return items, nil
}

const commandReliabilityQuery = `
	SELECT logs.vehicle_id, v.display_name,
	       COUNT(*)::bigint AS attempt_count,
	       COUNT(*) FILTER (WHERE logs.status = 'failed')::bigint AS failure_count,
	       MAX(logs.created_at) FILTER (WHERE logs.status = 'failed') AS latest_failure_at
	FROM command_logs logs
	JOIN vehicles v ON v.id = logs.vehicle_id
	WHERE logs.created_at >= $1
	  AND logs.status IN ('success', 'failed')
	  AND v.archived_at IS NULL
	  AND ($2::bigint IS NULL OR logs.vehicle_id = $2)
	GROUP BY logs.vehicle_id, v.display_name
	HAVING COUNT(*) FILTER (WHERE logs.status = 'failed') > 0
	ORDER BY
	  COUNT(*) FILTER (WHERE logs.status = 'failed')::float8 / NULLIF(COUNT(*), 0) DESC,
	  latest_failure_at DESC
	LIMIT $3`

func (r *SourceRepository) ListCommandReliability(
	ctx context.Context,
	vehicleID *int64,
	since, checkedAt time.Time,
	limit int,
) ([]domain.CommandReliabilityRecord, error) {
	rows, err := r.q.Query(ctx, commandReliabilityQuery, since, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("list action center command reliability: %w", err)
	}
	defer rows.Close()

	items := make([]domain.CommandReliabilityRecord, 0)
	for rows.Next() {
		var item domain.CommandReliabilityRecord
		if err := rows.Scan(
			&item.Vehicle.ID,
			&item.Vehicle.DisplayName,
			&item.AttemptCount,
			&item.FailureCount,
			&item.LatestFailureAt,
		); err != nil {
			return nil, fmt.Errorf("scan action center command reliability: %w", err)
		}
		item.WindowStart = since
		item.CheckedAt = checkedAt
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center command reliability: %w", err)
	}
	return items, nil
}

const openSystemIncidentsQuery = `
	SELECT id, title, description, severity, status,
	       affected_components, started_at, updated_at
	FROM status_incidents
	WHERE resolved_at IS NULL
	ORDER BY
	  CASE severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END,
	  started_at DESC,
	  id DESC
	LIMIT $1`

func (r *SourceRepository) ListOpenSystemIncidents(
	ctx context.Context,
	limit int,
) ([]domain.SystemIncidentRecord, error) {
	rows, err := r.q.Query(ctx, openSystemIncidentsQuery, limit)
	if err != nil {
		return nil, fmt.Errorf("list action center system incidents: %w", err)
	}
	defer rows.Close()

	items := make([]domain.SystemIncidentRecord, 0)
	for rows.Next() {
		var item domain.SystemIncidentRecord
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Description,
			&item.Severity,
			&item.Status,
			&item.AffectedComponents,
			&item.StartedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan action center system incident: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate action center system incidents: %w", err)
	}
	return items, nil
}
