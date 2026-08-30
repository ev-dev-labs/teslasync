package datarepair

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// This file holds the read-only SQL surface behind Repo.ListSessionAnomalies:
// a small, fixed number of bounded queries (never one per row) that feed the
// pure classifiers in anomaly_classify.go.
//
// Every query below only ever reads CLOSED sessions (ended_at IS NOT NULL)
// for the overlap/duplicate rules. Open sessions are the existing
// evidence-based diagnosis's territory (ListOpenDrives / ListOpenChargingSessions
// / ListOverrunDrives / ListOverrunChargingSessions in repo.go) and are
// deliberately out of scope here, per the package boundary documented on
// Anomaly in anomaly.go.

// ListSessionAnomalies runs a bounded, read-only scan for conservative
// session-integrity anomalies across drives and charging_sessions, starting
// at `since`, optionally restricted to one vehicle, and capped at `limit`
// (clamped to maxAnomalyLimit regardless of what the caller requests).
//
// This is a detector, not a diagnosis: every returned Anomaly has
// Applicable == false and no boundary is synthesized or suggested. The
// intended caller is a future background scanner that materializes these
// into data_repair_cases rows for operator review — see the doc comment on
// the Anomaly type for the exact contract.
func (r *Repo) ListSessionAnomalies(ctx context.Context, since time.Time, vehicleID *int64, limit int) (AnomalyScanResult, error) {
	if err := r.ready(); err != nil {
		return AnomalyScanResult{}, err
	}
	effLimit := clampAnomalyLimit(limit)
	vf := nullableVehicleID(vehicleID)

	driveRows, err := r.scanDriveAnomalyRows(ctx, since, vf, effLimit)
	if err != nil {
		return AnomalyScanResult{}, err
	}
	chargingRows, err := r.scanChargingAnomalyRows(ctx, since, vf, effLimit)
	if err != nil {
		return AnomalyScanResult{}, err
	}
	driveOverlaps, err := r.scanDriveDriveOverlaps(ctx, since, vf, effLimit)
	if err != nil {
		return AnomalyScanResult{}, err
	}
	chargingOverlaps, err := r.scanChargingChargingOverlaps(ctx, since, vf, effLimit)
	if err != nil {
		return AnomalyScanResult{}, err
	}
	crossOverlaps, err := r.scanCrossKindOverlaps(ctx, since, vf, effLimit)
	if err != nil {
		return AnomalyScanResult{}, err
	}

	anomalies := make([]Anomaly, 0, len(driveRows)+len(chargingRows)+len(driveOverlaps)+len(chargingOverlaps)+len(crossOverlaps))
	for _, row := range driveRows {
		anomalies = append(anomalies, classifyDriveRow(row)...)
	}
	for _, row := range chargingRows {
		anomalies = append(anomalies, classifyChargingRow(row)...)
	}
	for _, pair := range driveOverlaps {
		anomalies = append(anomalies, classifyOverlap(pair))
	}
	for _, pair := range chargingOverlaps {
		anomalies = append(anomalies, classifyOverlap(pair))
	}
	for _, pair := range crossOverlaps {
		anomalies = append(anomalies, classifyOverlap(pair))
	}

	sortAnomalies(anomalies)
	out, truncated := truncateAnomalies(anomalies, effLimit)
	sourceLimitReached := anySourceAtLimit(
		effLimit,
		len(driveRows),
		len(chargingRows),
		len(driveOverlaps),
		len(chargingOverlaps),
		len(crossOverlaps),
	)
	return AnomalyScanResult{
		Anomalies: out,
		Truncated: truncated || sourceLimitReached,
	}, nil
}

func anySourceAtLimit(limit int, sourceCounts ...int) bool {
	for _, count := range sourceCounts {
		if count >= limit {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Single-session candidate scans
// ---------------------------------------------------------------------------

// driveAnomalyRowsQuery filters in SQL (not in Go) for every single-session
// drive rule at once, so the LIMIT bounds genuinely anomalous rows rather
// than silently truncating a scan of ordinary history before it ever reaches
// an anomaly. The OR'd predicates intentionally mirror the checks
// re-evaluated in Go by classifyDriveRow, which is what decides WHICH
// specific rule(s) a returned row tripped.
const driveAnomalyRowsQuery = `
	SELECT id, vehicle_id, started_at, ended_at, duration_s, distance_m,
	       start_odometer_m, end_odometer_m, start_soc_pct, end_soc_pct,
	       energy_used_wh, regen_energy_wh
	FROM drives
	WHERE started_at >= $1
	  AND ($2::bigint IS NULL OR vehicle_id = $2)
	  AND (
	        (ended_at IS NOT NULL AND ended_at <= started_at)
	     OR (ended_at IS NOT NULL AND duration_s IS NOT NULL
	         AND ABS(duration_s - EXTRACT(EPOCH FROM (ended_at - started_at))::bigint) > $3)
	     OR (start_odometer_m IS NOT NULL AND end_odometer_m IS NOT NULL
	         AND end_odometer_m < start_odometer_m - $4)
	     OR (start_soc_pct IS NOT NULL AND end_soc_pct IS NOT NULL
	         AND end_soc_pct > start_soc_pct + $5)
	     OR (distance_m IS NOT NULL AND distance_m < 0)
	     OR (duration_s IS NOT NULL AND duration_s < 0)
	     OR (energy_used_wh IS NOT NULL AND energy_used_wh < 0)
	     OR (regen_energy_wh IS NOT NULL AND regen_energy_wh < 0)
	      )
	ORDER BY started_at DESC, id DESC
	LIMIT $6`

func (r *Repo) scanDriveAnomalyRows(ctx context.Context, since time.Time, vehicleFilter interface{}, limit int) ([]driveAnomalyRow, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "drives")
	defer span.End()

	rows, err := r.query.Query(ctx, driveAnomalyRowsQuery,
		since, vehicleFilter, durationMismatchToleranceS, odometerRollbackToleranceM, socToleranceDrivePct, limit)
	if err != nil {
		return nil, fmt.Errorf("data-repair: scan drive anomaly candidates: %w", err)
	}
	defer rows.Close()

	out := make([]driveAnomalyRow, 0, 16)
	for rows.Next() {
		var row driveAnomalyRow
		if err := rows.Scan(
			&row.ID, &row.VehicleID, &row.StartedAt, &row.EndedAt, &row.DurationS, &row.DistanceM,
			&row.StartOdometerM, &row.EndOdometerM, &row.StartSocPct, &row.EndSocPct,
			&row.EnergyUsedWh, &row.RegenEnergyWh,
		); err != nil {
			return nil, fmt.Errorf("data-repair: scan drive anomaly row: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate drive anomaly candidates: %w", err)
	}
	span.SetAttributes(tracing.RowCount(len(out)))
	return out, nil
}

// chargingAnomalyRowsQuery is the charging_sessions counterpart of
// driveAnomalyRowsQuery. Charging sessions have no stored duration column,
// so there is no duration-mismatch predicate here, and the SoC direction is
// reversed (a charge must not materially LOSE SoC).
const chargingAnomalyRowsQuery = `
	SELECT id, vehicle_id, started_at, ended_at,
	       start_odometer_m, end_odometer_m, start_soc_pct, end_soc_pct,
	       total_energy_added_wh
	FROM charging_sessions
	WHERE started_at >= $1
	  AND ($2::bigint IS NULL OR vehicle_id = $2)
	  AND (
	        (ended_at IS NOT NULL AND ended_at <= started_at)
	     OR (start_odometer_m IS NOT NULL AND end_odometer_m IS NOT NULL
	         AND end_odometer_m < start_odometer_m - $3)
	     OR (start_soc_pct IS NOT NULL AND end_soc_pct IS NOT NULL
	         AND end_soc_pct < start_soc_pct - $4)
	     OR (total_energy_added_wh IS NOT NULL AND total_energy_added_wh < 0)
	      )
	ORDER BY started_at DESC, id DESC
	LIMIT $5`

func (r *Repo) scanChargingAnomalyRows(ctx context.Context, since time.Time, vehicleFilter interface{}, limit int) ([]chargingAnomalyRow, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "charging_sessions")
	defer span.End()

	rows, err := r.query.Query(ctx, chargingAnomalyRowsQuery,
		since, vehicleFilter, odometerRollbackToleranceM, socToleranceChargingPct, limit)
	if err != nil {
		return nil, fmt.Errorf("data-repair: scan charging anomaly candidates: %w", err)
	}
	defer rows.Close()

	out := make([]chargingAnomalyRow, 0, 16)
	for rows.Next() {
		var row chargingAnomalyRow
		if err := rows.Scan(
			&row.ID, &row.VehicleID, &row.StartedAt, &row.EndedAt,
			&row.StartOdometerM, &row.EndOdometerM, &row.StartSocPct, &row.EndSocPct,
			&row.TotalEnergyAddedWh,
		); err != nil {
			return nil, fmt.Errorf("data-repair: scan charging anomaly row: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate charging anomaly candidates: %w", err)
	}
	span.SetAttributes(tracing.RowCount(len(out)))
	return out, nil
}

// ---------------------------------------------------------------------------
// Overlap / duplicate-window pair scans
// ---------------------------------------------------------------------------

// driveDriveOverlapQuery self-joins drives on vehicle_id with d2.id > d1.id,
// which both bounds each pair to a single direction (avoiding double
// counting) and gives a stable canonical (SessionID, RelatedSessionID)
// assignment: SessionID is always the lower id. Only CLOSED drives
// participate — an in-progress drive's "overlap" with a later drive is not
// yet a meaningful comparison and is the open-boundary diagnosis's territory.
const driveDriveOverlapQuery = `
	SELECT d1.id, d1.vehicle_id, d1.started_at, d1.ended_at,
	       d2.id, d2.started_at, d2.ended_at
	FROM drives d1
	JOIN drives d2
	  ON d2.vehicle_id = d1.vehicle_id
	 AND d2.id > d1.id
	WHERE (d1.started_at >= $1 OR d2.started_at >= $1)
	  AND ($2::bigint IS NULL OR d1.vehicle_id = $2)
	  AND d1.ended_at IS NOT NULL
	  AND d2.ended_at IS NOT NULL
	  AND d1.ended_at >= $1
	  AND d2.ended_at >= $1
	  AND d1.started_at < d2.ended_at
	  AND d2.started_at < d1.ended_at
	  AND (
	    (d1.started_at = d2.started_at AND d1.ended_at = d2.ended_at)
	    OR EXTRACT(EPOCH FROM (LEAST(d1.ended_at, d2.ended_at) -
	                           GREATEST(d1.started_at, d2.started_at))) > $3
	  )
	ORDER BY d1.vehicle_id, d1.started_at, d2.id
	LIMIT $4`

func (r *Repo) scanDriveDriveOverlaps(ctx context.Context, since time.Time, vehicleFilter interface{}, limit int) ([]overlapCandidate, error) {
	return r.scanOverlapPairs(ctx, "drives", driveDriveOverlapQuery, AnomalyKindDrive, true, since, vehicleFilter, limit)
}

// chargingChargingOverlapQuery mirrors driveDriveOverlapQuery for
// charging_sessions.
const chargingChargingOverlapQuery = `
	SELECT c1.id, c1.vehicle_id, c1.started_at, c1.ended_at,
	       c2.id, c2.started_at, c2.ended_at
	FROM charging_sessions c1
	JOIN charging_sessions c2
	  ON c2.vehicle_id = c1.vehicle_id
	 AND c2.id > c1.id
	WHERE (c1.started_at >= $1 OR c2.started_at >= $1)
	  AND ($2::bigint IS NULL OR c1.vehicle_id = $2)
	  AND c1.ended_at IS NOT NULL
	  AND c2.ended_at IS NOT NULL
	  AND c1.ended_at >= $1
	  AND c2.ended_at >= $1
	  AND c1.started_at < c2.ended_at
	  AND c2.started_at < c1.ended_at
	  AND (
	    (c1.started_at = c2.started_at AND c1.ended_at = c2.ended_at)
	    OR EXTRACT(EPOCH FROM (LEAST(c1.ended_at, c2.ended_at) -
	                           GREATEST(c1.started_at, c2.started_at))) > $3
	  )
	ORDER BY c1.vehicle_id, c1.started_at, c2.id
	LIMIT $4`

func (r *Repo) scanChargingChargingOverlaps(ctx context.Context, since time.Time, vehicleFilter interface{}, limit int) ([]overlapCandidate, error) {
	return r.scanOverlapPairs(ctx, "charging_sessions", chargingChargingOverlapQuery, AnomalyKindCharging, true, since, vehicleFilter, limit)
}

// crossKindOverlapQuery pairs a CLOSED drive with a CLOSED charging session
// for the same vehicle whose windows overlap — physically impossible, since
// a vehicle cannot drive and charge at the same time. The drive is always
// the primary/SessionID side (see RuleCrossKindOverlap).
const crossKindOverlapQuery = `
	SELECT d.id, d.vehicle_id, d.started_at, d.ended_at,
	       c.id, c.started_at, c.ended_at
	FROM drives d
	JOIN charging_sessions c
	  ON c.vehicle_id = d.vehicle_id
	WHERE (d.started_at >= $1 OR c.started_at >= $1)
	  AND ($2::bigint IS NULL OR d.vehicle_id = $2)
	  AND d.ended_at IS NOT NULL
	  AND c.ended_at IS NOT NULL
	  AND d.ended_at >= $1
	  AND c.ended_at >= $1
	  AND d.started_at < c.ended_at
	  AND c.started_at < d.ended_at
	  AND EXTRACT(EPOCH FROM (LEAST(d.ended_at, c.ended_at) -
	                          GREATEST(d.started_at, c.started_at))) > $3
	ORDER BY d.vehicle_id, d.started_at, c.id
	LIMIT $4`

func (r *Repo) scanCrossKindOverlaps(ctx context.Context, since time.Time, vehicleFilter interface{}, limit int) ([]overlapCandidate, error) {
	return r.scanOverlapPairs(ctx, "drives", crossKindOverlapQuery, AnomalyKindDrive, false, since, vehicleFilter, limit)
}

// scanOverlapPairs runs one of the three overlap queries above, all of which
// share the exact same 7-column result shape
// (id, vehicle_id, started_at, ended_at, other_id, other_started_at, other_ended_at).
func (r *Repo) scanOverlapPairs(
	ctx context.Context,
	table, query string,
	kind AnomalyKind,
	sameKind bool,
	since time.Time,
	vehicleFilter interface{},
	limit int,
) ([]overlapCandidate, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", table)
	defer span.End()

	rows, err := r.query.Query(ctx, query, since, vehicleFilter, overlapToleranceS, limit)
	if err != nil {
		return nil, fmt.Errorf("data-repair: scan %s overlap candidates: %w", table, err)
	}
	defer rows.Close()

	out := make([]overlapCandidate, 0, 8)
	for rows.Next() {
		var c overlapCandidate
		c.Kind = kind
		c.SameKind = sameKind
		if err := rows.Scan(
			&c.SessionID, &c.VehicleID, &c.SessionStartedAt, &c.SessionEndedAt,
			&c.RelatedSessionID, &c.RelatedStartedAt, &c.RelatedEndedAt,
		); err != nil {
			return nil, fmt.Errorf("data-repair: scan %s overlap row: %w", table, err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate %s overlap candidates: %w", table, err)
	}
	span.SetAttributes(tracing.RowCount(len(out)))
	return out, nil
}
