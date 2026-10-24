// Package drive backs the /mileage/monthly and /mileage/stats endpoints.
//
// The legacy daily_mileage table no longer exists, so this repo re-derives
// the same product surface from the SI-canonical drives table (migration
// 000185), grouping per `date_trunc` over the caller's `?timezone` frame
// for the monthly/daily endpoints and using FILTER aggregates for stats.
//
// Schema reality:
//
//	mig 000185 stores drives with SI-canonical column names:
//	  drives.distance_m       DOUBLE PRECISION  (meters, NOT distance_km)
//	  drives.energy_used_wh   DOUBLE PRECISION  (Watt-hours, NOT energy_used_kwh)
//
// This repo uses the actual column names and converts to km / kWh in
// the SELECT list. Energy availability is explicit:
// energy_used_wh exists, so total_wh_consumed and avg_efficiency_wh_per_km
// are populated. Frontend hooks (MileageStats / MonthlyStat in
// web/src/types/analytics.ts) currently use legacy camelCase fields from
// the deleted handler; aligning those types belongs to the frontend boundary.
package drive

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MileageMonthlyRow is one bucket in the monthly response. The bucket
// timestamp is the start of the month in the caller's zone frame
// (date_trunc over zone wall-time in PostgreSQL); the handler renders
// it as 'YYYY-MM'.
//
// total_wh_consumed and avg_efficiency_wh_per_km are pointers because
// energy_used_wh is nullable in mig 000185 — a drive with NULL energy
// rows still contributes to drive_count and total_km but its energy
// share is dropped (we never fabricate a zero kWh value).
type MileageMonthlyRow struct {
	Bucket               time.Time
	DriveCount           int
	TotalKm              float64
	TotalWhConsumed      *float64
	AvgEfficiencyWhPerKm *float64
}

// MileageDailyRow is one bucket in the daily response. The bucket
// timestamp is the start of a calendar day in the caller's zone frame
// (DATE(started_at AT TIME ZONE $3) in PostgreSQL); the handler renders
// it as 'YYYY-MM-DD'.
//
// EndOdometerKm is a pointer because end_odometer_m is nullable on the
// drives table — a drive that ended before the telemetry plant captured
// a final odometer reading still contributes to drive_count and total_km
// but its odometer share is dropped (we never fabricate a zero value).
type MileageDailyRow struct {
	Day           time.Time
	DriveCount    int
	TotalKm       float64
	EndOdometerKm *float64
}

// MileageStats is the rollup returned by /mileage/stats. The drive_count_*
// fields exclude rows with NULL or zero distance_m so per-drive averages
// downstream don't divide by ghost drives. first_drive_at / last_drive_at
// are pointers so a vehicle with zero recorded drives reports JSON null
// (not the Go zero time.Time, which would marshal to "0001-01-01T...").
type MileageStats struct {
	LifetimeKm         float64
	Last7dKm           float64
	Last30dKm          float64
	Last365dKm         float64
	DriveCountLifetime int
	DriveCount30d      int
	FirstDriveAt       *time.Time
	LastDriveAt        *time.Time
}

// mileagePool is the minimal pgxpool subset MileageRepo needs.
// Declared locally so tests can supply a fake without dragging in
// pgxmock (the codebase does not vendor pgxmock).
type mileagePool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// MileageRepo serves /mileage/monthly + /mileage/stats derived from
// the SI-canonical drives table. Construct via NewMileageRepo.
type MileageRepo struct {
	pool mileagePool
}

// NewMileageRepo binds the repo to a pgx pool. Mirrors the snapshot-
// writer fail-fast precedent — a nil pool at construction is a wiring
// bug, not a runtime condition.
func NewMileageRepo(pool *pgxpool.Pool) *MileageRepo {
	if pool == nil {
		panic("database.NewMileageRepo: pool must not be nil")
	}
	return &MileageRepo{pool: pool}
}

// monthlySelectSQL is exposed as a package-level constant so the SQL-
// shape test in mileage_repo_test.go can assert column names + GROUP BY
// + ORDER BY direction without needing a real DB. A typo on the
// SI-canonical column names (distance_m, energy_used_wh) would otherwise
// only surface at runtime in production.
//
// Filters:
//   - vehicle_id = $1
//   - started_at >= $2 (window start instant)
//   - distance_m IS NOT NULL AND distance_m > 0 (Decision #7e — NULL
//     distance rows are skipped, not erroring; zero-distance rows are
//     treated as ghost drives with no mileage to report).
//
// Months are attributed in the caller's `?timezone` frame ($3, UTC when
// omitted) so the buckets line up with the user's selected zone. The
// bucket is zone wall-time (a bare timestamp); the handler renders only
// YYYY-MM from it, which is zone-correct — never convert it as an instant.
//
// Per-bucket aggregates keep energy in SI watt-hours. Distance remains in
// kilometres until the deferred _km rename slice changes the mileage surface.
const monthlySelectSQL = `
SELECT
    date_trunc('month', started_at AT TIME ZONE $3) AS bucket,
    COUNT(*)                                            AS drive_count,
    COALESCE(SUM(distance_m), 0) / 1000.0               AS total_km,
    SUM(energy_used_wh)                                 AS total_wh,
    SUM(distance_m)                                     AS total_distance_m
FROM drives
WHERE vehicle_id = $1
  AND started_at >= $2
  AND distance_m IS NOT NULL
  AND distance_m > 0
GROUP BY bucket
ORDER BY bucket ASC
`

// statsSelectSQL pins the lifetime + windowed rollups in a single
// round-trip. FILTER (WHERE ...) clauses gate per-window aggregates so
// the planner can scan drives once. NULL distance rows are excluded
// from drive_count_* (Decision #7e); the SUM expressions tolerate NULL
// distance via COALESCE because the row is filtered out anyway, but
// the COALESCE keeps the surface explicit.
const statsSelectSQL = `
SELECT
    COALESCE(SUM(distance_m), 0) / 1000.0                                                          AS lifetime_km,
    COALESCE(SUM(distance_m) FILTER (WHERE started_at >= $2), 0) / 1000.0                          AS last_7d_km,
    COALESCE(SUM(distance_m) FILTER (WHERE started_at >= $3), 0) / 1000.0                          AS last_30d_km,
    COALESCE(SUM(distance_m) FILTER (WHERE started_at >= $4), 0) / 1000.0                          AS last_365d_km,
    COUNT(*) FILTER (WHERE distance_m IS NOT NULL AND distance_m > 0)                              AS drive_count_lifetime,
    COUNT(*) FILTER (WHERE distance_m IS NOT NULL AND distance_m > 0 AND started_at >= $3)         AS drive_count_30d,
    MIN(started_at) FILTER (WHERE distance_m IS NOT NULL AND distance_m > 0)                       AS first_drive_at,
    MAX(started_at) FILTER (WHERE distance_m IS NOT NULL AND distance_m > 0)                       AS last_drive_at
FROM drives
WHERE vehicle_id = $1
`

// mileageVehicleExistsSQL probes the vehicles row for a 404-vs-200-empty
// disambiguation. Matches the precedent in vehicle_states_repo.go (mig
// 000185 also has no FK from drives.vehicle_id — see the comment block
// at the top of mig 000185 around line 124-126 — so dangling drive rows
// for a deleted vehicle would otherwise produce 200 with stale data).
const mileageVehicleExistsSQL = `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = $1)`

// dailySelectSQL pins the per-day buckets used by /mileage/daily.
// It uses the same SI-canonical column names as monthlySelectSQL:
// distance_m is meters, and end_odometer_m is meters. Conversion to
// kilometres happens in the SELECT list so the
// handler response stays consistent with /mileage/monthly's _km surface.
//
// NULL distance rows are skipped across the mileage family.
// end_odometer_m may still be
// NULL on rows that DO have a non-zero distance_m — in that case MAX()
// over the bucket returns NULL and we surface it as JSON null via the
// repo's *float64 column instead of fabricating a zero.
//
// ORDER BY day ASC matches /mileage/monthly's ascending contract so the
// frontend can render the time series left-to-right without re-sorting.
//
// Days are attributed in the caller's `?timezone` frame ($3, UTC when
// omitted) so drives near midnight land on the day the user experienced.
// The day is a zone-framed calendar date; the handler renders only
// YYYY-MM-DD from it.
const dailySelectSQL = `
SELECT
    DATE(started_at AT TIME ZONE $3)         AS day,
    COUNT(*)                                    AS drive_count,
    COALESCE(SUM(distance_m), 0) / 1000.0       AS total_km,
    MAX(end_odometer_m) / 1000.0                AS end_odometer_km
FROM drives
WHERE vehicle_id = $1
  AND started_at >= $2
  AND distance_m IS NOT NULL
  AND distance_m > 0
GROUP BY day
ORDER BY day ASC
`

// VehicleExists reports whether a row exists in the vehicles table for
// vehicleID. Used by the handler to return 404 (unknown vehicle) vs 200
// with empty rollups (vehicle exists but has no drives yet).
func (r *MileageRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx, mileageVehicleExistsSQL, vehicleID).Scan(&exists); err != nil {
		return false, fmt.Errorf("mileage: probe vehicle existence: %w", err)
	}
	return exists, nil
}

// Monthly returns one row per calendar month (in the zone frame) for
// vehicleID, oldest first, restricted to drives whose started_at is >=
// windowStart. The caller controls the window width (typically 24 months).
func (r *MileageRepo) Monthly(ctx context.Context, vehicleID int64, windowStart time.Time, zone string) ([]MileageMonthlyRow, error) {
	rows, err := r.pool.Query(ctx, monthlySelectSQL, vehicleID, windowStart, zone)
	if err != nil {
		return nil, fmt.Errorf("mileage: monthly query: %w", err)
	}
	defer rows.Close()

	out := make([]MileageMonthlyRow, 0)
	for rows.Next() {
		var (
			row            MileageMonthlyRow
			totalWh        *float64
			totalDistanceM *float64
		)
		if err := rows.Scan(
			&row.Bucket,
			&row.DriveCount,
			&row.TotalKm,
			&totalWh,
			&totalDistanceM,
		); err != nil {
			return nil, fmt.Errorf("mileage: monthly row scan: %w", err)
		}
		row.TotalWhConsumed = totalWh
		// avg_efficiency_wh_per_km is computed in Go from the same
		// SUM(energy_used_wh) and SUM(distance_m) aggregates we already
		// pulled. Computing in Go (rather than a SQL `CASE WHEN ...
		// END` expression) keeps the SI-vs-presentation conversion in
		// one place and avoids a SQL divide-by-zero edge case if a
		// future schema change relaxes the distance_m > 0 filter.
		if totalWh != nil && totalDistanceM != nil && *totalDistanceM > 0 {
			km := *totalDistanceM / 1000.0
			eff := *totalWh / km
			row.AvgEfficiencyWhPerKm = &eff
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mileage: monthly rows iter: %w", err)
	}
	return out, nil
}

// Stats returns the lifetime + windowed rollups for vehicleID. The
// caller supplies the three window cut-offs (now-7d, now-30d, now-365d)
// so the handler's clock injection covers every time-derived field in
// one place.
func (r *MileageRepo) Stats(ctx context.Context, vehicleID int64, since7d, since30d, since365d time.Time) (MileageStats, error) {
	var s MileageStats
	err := r.pool.QueryRow(ctx, statsSelectSQL, vehicleID, since7d, since30d, since365d).Scan(
		&s.LifetimeKm,
		&s.Last7dKm,
		&s.Last30dKm,
		&s.Last365dKm,
		&s.DriveCountLifetime,
		&s.DriveCount30d,
		&s.FirstDriveAt,
		&s.LastDriveAt,
	)
	if err != nil {
		return MileageStats{}, fmt.Errorf("mileage: stats query: %w", err)
	}
	return s, nil
}

// Daily returns one row per calendar day (in the zone frame) for
// vehicleID, oldest first, restricted to drives whose started_at is >=
// windowStart. The caller controls the window width (typically 90 days).
//
// Days with no qualifying drives (zero distance_m, or all NULL distance)
// produce no row — the frontend chart treats absence as a gap rather
// than imputing zero.
func (r *MileageRepo) Daily(ctx context.Context, vehicleID int64, windowStart time.Time, zone string) ([]MileageDailyRow, error) {
	rows, err := r.pool.Query(ctx, dailySelectSQL, vehicleID, windowStart, zone)
	if err != nil {
		return nil, fmt.Errorf("mileage: daily query: %w", err)
	}
	defer rows.Close()

	out := make([]MileageDailyRow, 0)
	for rows.Next() {
		var (
			row           MileageDailyRow
			endOdometerKm *float64
		)
		if err := rows.Scan(
			&row.Day,
			&row.DriveCount,
			&row.TotalKm,
			&endOdometerKm,
		); err != nil {
			return nil, fmt.Errorf("mileage: daily row scan: %w", err)
		}
		row.EndOdometerKm = endOdometerKm
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mileage: daily rows iter: %w", err)
	}
	return out, nil
}
