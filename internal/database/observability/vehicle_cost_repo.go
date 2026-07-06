package observability

// Per-vehicle cost telemetry summarizes three fleet-cost dimensions:
// per-vehicle signal_log row count + bytes
// (storage footprint), per-vehicle 24h ingest rate (network/cpu
// pressure), and per-vehicle DLQ failure count (poison-pill noise).
//
// The methods live in a separate file from ingest_xray_repo.go so a
// future split into a CostRepo type would be clean. Today they share
// the same struct + connection pool because both query signal_log.

import (
	"context"
	"fmt"
	"time"
)

// VehicleCostRow is the per-vehicle cost summary.
type VehicleCostRow struct {
	VehicleID      int64     `json:"vehicle_id"`
	DisplayName    *string   `json:"display_name,omitempty"`
	SignalRowCount int64     `json:"signal_row_count"`
	SignalBytesEst int64     `json:"signal_bytes_est"`
	IngestRate24h  float64   `json:"ingest_rate_per_minute_24h"`
	DLQFailures24h int64     `json:"dlq_failures_24h"`
	LastSeenAt     time.Time `json:"last_seen_at"`
}

// VehicleCostTotals is the fleet sum surfaced alongside the rows so the
// UI can compute % share without re-summing client-side.
type VehicleCostTotals struct {
	TotalRows     int64   `json:"total_rows"`
	TotalBytesEst int64   `json:"total_bytes_est"`
	TotalRate24h  float64 `json:"total_rate_per_minute_24h"`
	TotalFailures int64   `json:"total_failures_24h"`
}

// VehicleCostReport bundles per-vehicle rows + totals.
type VehicleCostReport struct {
	Vehicles []VehicleCostRow  `json:"vehicles"`
	Totals   VehicleCostTotals `json:"totals"`
}

// VehicleCostReport returns the per-vehicle cost summary plus the
// fleet totals. The byte estimate is row count × 96 bytes/row (a
// conservative average for normalized signal_log rows based on
// `pg_stat_user_tables.n_tup_ins` × avg row size). It is an
// estimate not a measurement to avoid a per-call `pg_total_relation_size`
// scan; the admin UI labels it accordingly.
func (r *IngestXRayRepo) VehicleCostReport(ctx context.Context, since time.Time, limit int) (*VehicleCostReport, error) {
	if r == nil || r.exec == nil {
		return nil, fmt.Errorf("database: VehicleCostReport: nil repo or pool")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}

	// Single query joins signal_log (cost) ⟕ vehicles (name) ⟕
	// signal_log_failures (DLQ count). LEFT JOIN preserves vehicles
	// with zero DLQ entries.
	const sql = `
WITH agg AS (
  SELECT vehicle_id,
         COUNT(*)::bigint AS row_count,
         MAX(ts)          AS last_seen,
         (COUNT(*) FILTER (WHERE ts >= now() - interval '24 hours'))::float8 / (24.0 * 60.0) AS rate_24h
    FROM signal_log
   WHERE ts >= $1
   GROUP BY vehicle_id
), dlq AS (
  SELECT vehicle_id,
         COUNT(*)::bigint AS fail_24h
    FROM signal_log_failures
   WHERE first_seen >= now() - interval '24 hours'
   GROUP BY vehicle_id
)
SELECT a.vehicle_id,
       v.display_name,
       a.row_count,
       a.row_count * 96 AS bytes_est,
       a.rate_24h,
       COALESCE(d.fail_24h, 0),
       a.last_seen
  FROM agg a
  LEFT JOIN vehicles v ON v.id = a.vehicle_id
  LEFT JOIN dlq d      ON d.vehicle_id = a.vehicle_id
 ORDER BY a.row_count DESC
 LIMIT $2`

	rows, err := r.exec.Query(ctx, sql, since, limit)
	if err != nil {
		// Older installations might not have signal_log_failures.
		// Surface the report without DLQ counts rather than failing
		// the row-count view.
		if isMissingRelationError(err) {
			return r.vehicleCostReportNoDLQ(ctx, since, limit)
		}
		return nil, fmt.Errorf("database: VehicleCostReport: query: %w", err)
	}
	defer rows.Close()

	rep := &VehicleCostReport{Vehicles: []VehicleCostRow{}}
	for rows.Next() {
		var row VehicleCostRow
		if err := rows.Scan(&row.VehicleID, &row.DisplayName, &row.SignalRowCount,
			&row.SignalBytesEst, &row.IngestRate24h, &row.DLQFailures24h,
			&row.LastSeenAt); err != nil {
			return nil, fmt.Errorf("database: VehicleCostReport: scan: %w", err)
		}
		rep.Vehicles = append(rep.Vehicles, row)
		rep.Totals.TotalRows += row.SignalRowCount
		rep.Totals.TotalBytesEst += row.SignalBytesEst
		rep.Totals.TotalRate24h += row.IngestRate24h
		rep.Totals.TotalFailures += row.DLQFailures24h
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: VehicleCostReport: rows: %w", err)
	}
	return rep, nil
}

// vehicleCostReportNoDLQ runs the cost report against installations
// that lack signal_log_failures. Mirrors VehicleCostReport but skips
// the DLQ CTE.
func (r *IngestXRayRepo) vehicleCostReportNoDLQ(ctx context.Context, since time.Time, limit int) (*VehicleCostReport, error) {
	const sql = `
WITH agg AS (
  SELECT vehicle_id,
         COUNT(*)::bigint AS row_count,
         MAX(ts)          AS last_seen,
         (COUNT(*) FILTER (WHERE ts >= now() - interval '24 hours'))::float8 / (24.0 * 60.0) AS rate_24h
    FROM signal_log
   WHERE ts >= $1
   GROUP BY vehicle_id
)
SELECT a.vehicle_id,
       v.display_name,
       a.row_count,
       a.row_count * 96 AS bytes_est,
       a.rate_24h,
       0::bigint        AS fail_24h,
       a.last_seen
  FROM agg a
  LEFT JOIN vehicles v ON v.id = a.vehicle_id
 ORDER BY a.row_count DESC
 LIMIT $2`
	rows, err := r.exec.Query(ctx, sql, since, limit)
	if err != nil {
		return nil, fmt.Errorf("database: vehicleCostReportNoDLQ: query: %w", err)
	}
	defer rows.Close()
	rep := &VehicleCostReport{Vehicles: []VehicleCostRow{}}
	for rows.Next() {
		var row VehicleCostRow
		if err := rows.Scan(&row.VehicleID, &row.DisplayName, &row.SignalRowCount,
			&row.SignalBytesEst, &row.IngestRate24h, &row.DLQFailures24h,
			&row.LastSeenAt); err != nil {
			return nil, fmt.Errorf("database: vehicleCostReportNoDLQ: scan: %w", err)
		}
		rep.Vehicles = append(rep.Vehicles, row)
		rep.Totals.TotalRows += row.SignalRowCount
		rep.Totals.TotalBytesEst += row.SignalBytesEst
		rep.Totals.TotalRate24h += row.IngestRate24h
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: vehicleCostReportNoDLQ: rows: %w", err)
	}
	return rep, nil
}
