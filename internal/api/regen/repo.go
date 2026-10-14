package regen

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// driveRegenRow is a single scanned drives-table row feeding the
// per-drive regen breakdown. The …M / …S / …Mps / …W fields carry raw
// SI-canonical values straight from the drives schema (migration 000185);
// display-boundary conversions (e.g. metres → miles) happen in the
// handler, not here.
//
// PowerMinW is always nil in production: the drives table has no
// per-drive minimum/regen power column (only avg_power_w / peak_power_w),
// so driveRegenSQL selects NULL::float8 for it. It is retained in the
// port so the handler's regen-score math stays exercised and forward-
// compatible if a future migration adds a source column.
type driveRegenRow struct {
	ID          int64
	StartDate   time.Time
	DistanceM   *float64
	DurationS   *int64
	SpeedAvgMps *float64
	PowerAvgW   *float64
	PowerMinW   *float64
	StartSocPct *float64
	EndSocPct   *float64
	Efficiency  float64
}

// monthlyRegenRow is one month bucket derived from the drives table.
// AvgPowerW is SI watts. The downstream JSON key is avg_regen_power_kw
// for legacy stability, but the value stays in watts because the
// frontend renders it through formatPower, which itself converts from SI
// watts — dividing by 1000 here would double-convert and mis-scale the UI.
type monthlyRegenRow struct {
	Month       time.Time
	DriveCount  int
	AvgPowerW   *float64
	AvgSpeedMps *float64
	AvgEff      *float64
}

// regenRepository is the minimal data-access surface RegenHandler.Stats
// needs. It is declared as an interface so handler tests can inject a
// fake without a live database — the codebase does not vendor pgxmock.
type regenRepository interface {
	DriveRegens(ctx context.Context, vehicleID int64, hasRange bool, start, end time.Time) ([]driveRegenRow, error)
	MonthlyRegens(ctx context.Context, vehicleID int64, hasRange bool, start, end time.Time) ([]monthlyRegenRow, error)
	LifetimeEnergy(ctx context.Context, vehicleID int64, hasRange bool, start, end time.Time) (regenWh, driveWh float64, err error)
	VehicleModel(ctx context.Context, vehicleID int64) (vin, model string, err error)
}

// driveRegenSQL lists per-drive regen stats from the SI-canonical drives
// schema (migration 000185): distance_m, duration_s, avg_speed_mps,
// avg_power_w, start_soc_pct, end_soc_pct, started_at. The 7th column is
// NULL::float8 (min/regen power has no source column) so min_power_w and
// regen_score are null/0 in production; the placeholder keeps the scan
// order stable. Detail and monthly populations include ongoing drives and
// exclude drives of two miles or less. Efficiency is signed SOC percentage
// points consumed per mile, multiplied by 100; both SOC readings must be
// measured and in [0, 100]. Missing/invalid inputs are unknown, not zero.
const driveRegenSQL = `
		SELECT id, started_at, distance_m, duration_s, avg_speed_mps,
			avg_power_w, NULL::float8,
			start_soc_pct::float8, end_soc_pct::float8,
			CASE WHEN distance_m > 0 AND distance_m < 'Infinity'::float8
			          AND start_soc_pct BETWEEN 0 AND 100
			          AND end_soc_pct BETWEEN 0 AND 100
			     THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
			     END as efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3
			AND ($4::timestamptz IS NULL OR started_at BETWEEN $4 AND $5)
		ORDER BY started_at DESC`

// monthlyRegenSQL rolls the same drive set into month buckets. avg_power_w
// is averaged in SI watts; the handler keeps it in watts (see
// monthlyRegenRow) rather than converting to kW. Buckets are UTC calendar
// months, independent of the database session timezone; the instant filter
// still selects the exact requested population before bucketing. DriveCount
// counts all detail-eligible drives; each AVG denominator counts only its
// own valid measurements (not DriveCount). These are not recovered-energy
// totals: average power is signed drive power, not minimum braking power.
const monthlyRegenSQL = `
		SELECT DATE_TRUNC('month', started_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' as month,
			COUNT(*) as drive_count,
			AVG(avg_power_w) FILTER (WHERE avg_power_w > '-Infinity'::float8
			                             AND avg_power_w < 'Infinity'::float8) as avg_regen_power_w,
			AVG(avg_speed_mps) FILTER (WHERE avg_speed_mps >= 0
			                               AND avg_speed_mps < 'Infinity'::float8) as avg_speed_mps,
			AVG(CASE WHEN distance_m > 0 AND distance_m < 'Infinity'::float8
			              AND start_soc_pct BETWEEN 0 AND 100
			              AND end_soc_pct BETWEEN 0 AND 100
			         THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
			         END) as avg_efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3
			AND ($4::timestamptz IS NULL OR started_at BETWEEN $4 AND $5)
		GROUP BY month ORDER BY month`

// lifetimeEnergySQL sums regen/drive energy (SI watt-hours) from the
// drives table. Daily rollups cannot honor partial-day instant bounds.
// Select whole completed drives by their start instant, preserving the
// rollup's population (including short drives) without rounding the bounds
// or waiting for a materialized-view refresh. Numerator and denominator must
// both cover every selected completed drive, unlike the >two-mile detail
// population above. Finite signed/fractional energy is retained unchanged.
// Missing or invalid energy in either operand makes the totals unknown.
// The parser supplies inclusive
// SQL bounds, including its exclusive-end adjustment for RFC3339 inputs.
const lifetimeEnergySQL = `
		SELECT
			SUM(regen_energy_wh) FILTER (WHERE regen_energy_wh > '-Infinity'::float8
			                                 AND regen_energy_wh < 'Infinity'::float8),
			SUM(energy_used_wh) FILTER (WHERE energy_used_wh > '-Infinity'::float8
			                                AND energy_used_wh < 'Infinity'::float8),
			COUNT(*),
			COUNT(*) FILTER (WHERE regen_energy_wh > '-Infinity'::float8
			                       AND regen_energy_wh < 'Infinity'::float8
			                       AND energy_used_wh > '-Infinity'::float8
			                       AND energy_used_wh < 'Infinity'::float8)
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL
			AND ($2::timestamptz IS NULL OR started_at BETWEEN $2 AND $3)`

// vehicleModelSQL resolves the VIN + model used to estimate battery
// capacity.
const vehicleModelSQL = `SELECT vin, model FROM vehicles WHERE id = $1`

// regenRepo is the production pgx-backed implementation of
// regenRepository.
type regenRepo struct {
	db *database.DB
}

// newRegenRepo binds the repository to a database handle.
func newRegenRepo(db *database.DB) *regenRepo {
	return &regenRepo{db: db}
}

// DriveRegens returns the per-drive regen rows for a vehicle, optionally
// scoped to [start, end] when hasRange is true. Scan and coverage failures
// are returned, not silently dropped from the disclosed population.
func (r *regenRepo) DriveRegens(ctx context.Context, vehicleID int64, hasRange bool, start, end time.Time) ([]driveRegenRow, error) {
	rows, err := r.db.Pool.Query(ctx, driveRegenSQL,
		vehicleID, metersPerMile, twoMilesMeters,
		apiparams.NullableTime(hasRange, start), apiparams.NullableTime(hasRange, end))
	if err != nil {
		return nil, fmt.Errorf("query drive regen rows: %w", err)
	}
	defer rows.Close()

	out := make([]driveRegenRow, 0)
	for rows.Next() {
		var d driveRegenRow
		var efficiency *float64
		if err := rows.Scan(&d.ID, &d.StartDate, &d.DistanceM, &d.DurationS, &d.SpeedAvgMps,
			&d.PowerAvgW, &d.PowerMinW, &d.StartSocPct, &d.EndSocPct, &efficiency); err != nil {
			return nil, fmt.Errorf("scan drive regen row: %w", err)
		}
		if !finiteMeasurement(efficiency) {
			return nil, fmt.Errorf("drive %d efficiency coverage is missing or invalid", d.ID)
		}
		d.Efficiency = *efficiency
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate drive regen rows: %w", err)
	}
	return out, nil
}

// MonthlyRegens returns the month-bucketed regen summary rows for a
// vehicle, optionally scoped to [start, end]. Scan/iteration failure
// handling mirrors DriveRegens.
func (r *regenRepo) MonthlyRegens(ctx context.Context, vehicleID int64, hasRange bool, start, end time.Time) ([]monthlyRegenRow, error) {
	rows, err := r.db.Pool.Query(ctx, monthlyRegenSQL,
		vehicleID, metersPerMile, twoMilesMeters,
		apiparams.NullableTime(hasRange, start), apiparams.NullableTime(hasRange, end))
	if err != nil {
		return nil, fmt.Errorf("query monthly regen rows: %w", err)
	}
	defer rows.Close()

	out := make([]monthlyRegenRow, 0)
	for rows.Next() {
		var m monthlyRegenRow
		if err := rows.Scan(&m.Month, &m.DriveCount, &m.AvgPowerW, &m.AvgSpeedMps, &m.AvgEff); err != nil {
			return nil, fmt.Errorf("scan monthly regen row: %w", err)
		}
		// The existing response has non-nullable monthly metrics. Do not let
		// its formatter turn an unknown AVG into a measured zero.
		if !finiteMeasurement(m.AvgPowerW) || !finiteMeasurement(m.AvgSpeedMps) || !finiteMeasurement(m.AvgEff) {
			return nil, fmt.Errorf("monthly regen measurement coverage missing or invalid for %s", m.Month.Format("2006-01"))
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate monthly regen rows: %w", err)
	}
	return out, nil
}

// LifetimeEnergy sums lifetime regen/drive energy (watt-hours) from
// completed drives, optionally scoped to [start, end] by started_at. Unknown
// coverage is returned as an error so the existing handler exposes null totals,
// rather than fabricating measured zero or a ratio of mismatched populations.
func (r *regenRepo) LifetimeEnergy(ctx context.Context, vehicleID int64, hasRange bool, start, end time.Time) (float64, float64, error) {
	return scanLifetimeEnergy(r.db.Pool.QueryRow(ctx, lifetimeEnergySQL,
		vehicleID,
		apiparams.NullableTime(hasRange, start), apiparams.NullableTime(hasRange, end),
	))
}

func scanLifetimeEnergy(row pgx.Row) (float64, float64, error) {
	var regenWh, driveWh *float64
	var completed, eligible int64
	if err := row.Scan(&regenWh, &driveWh, &completed, &eligible); err != nil {
		return 0, 0, fmt.Errorf("query lifetime regen energy: %w", err)
	}
	if completed == 0 || eligible != completed || regenWh == nil || driveWh == nil {
		return 0, 0, fmt.Errorf("regen energy coverage unknown: %d of %d completed drives have both measurements", eligible, completed)
	}
	if !finiteMeasurement(regenWh) || !finiteMeasurement(driveWh) {
		return 0, 0, fmt.Errorf("regen energy totals are not finite")
	}
	return *regenWh, *driveWh, nil
}

func finiteMeasurement(value *float64) bool {
	return value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0)
}

// VehicleModel returns the VIN and model string for a vehicle. A NULL
// model column is normalised to the empty string; the caller decides how
// to treat a not-found vehicle (regen falls back to a default capacity).
func (r *regenRepo) VehicleModel(ctx context.Context, vehicleID int64) (string, string, error) {
	var vin string
	var model *string
	if err := r.db.Pool.QueryRow(ctx, vehicleModelSQL, vehicleID).Scan(&vin, &model); err != nil {
		return "", "", fmt.Errorf("query vehicle model: %w", err)
	}
	m := ""
	if model != nil {
		m = *model
	}
	return vin, m, nil
}
