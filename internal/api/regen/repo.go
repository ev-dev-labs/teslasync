package regen

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
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
// order stable. efficiency is SOC-consumed-per-mile, guarded against a
// zero-distance divide.
const driveRegenSQL = `
		SELECT id, started_at, distance_m, duration_s, avg_speed_mps,
			avg_power_w, NULL::float8,
			start_soc_pct::float8, end_soc_pct::float8,
			CASE WHEN distance_m > 0
			     THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
			     ELSE 0 END as efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3
			AND ($4::timestamptz IS NULL OR started_at BETWEEN $4 AND $5)
		ORDER BY started_at DESC`

// monthlyRegenSQL rolls the same drive set into month buckets. avg_power_w
// is averaged in SI watts; the handler keeps it in watts (see
// monthlyRegenRow) rather than converting to kW.
const monthlyRegenSQL = `
		SELECT DATE_TRUNC('month', started_at) as month,
			COUNT(*) as drive_count,
			AVG(ABS(COALESCE(avg_power_w, 0))) as avg_regen_power_w,
			AVG(avg_speed_mps) as avg_speed_mps,
			AVG(CASE WHEN distance_m > 0
			         THEN (start_soc_pct - end_soc_pct)::float / (distance_m / $2) * 100
			         ELSE 0 END) as avg_efficiency
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > $3
			AND ($4::timestamptz IS NULL OR started_at BETWEEN $4 AND $5)
		GROUP BY month ORDER BY month`

// lifetimeEnergySQL sums regen/drive energy (SI watt-hours) from the
// SI-canonical cagg_fleet_stats. The optional [start,end] window is
// applied against the daily `day` column so the lifetime totals stay in
// sync with the per-drive and monthly views.
const lifetimeEnergySQL = `
		SELECT
			COALESCE(SUM(total_regen_wh), 0),
			COALESCE(SUM(total_energy_wh), 0)
		FROM cagg_fleet_stats
		WHERE vehicle_id = $1
			AND ($2::date IS NULL OR day BETWEEN $2::date AND $3::date)`

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
// scoped to [start, end] when hasRange is true. Individual row-scan
// failures are logged and skipped so one malformed row cannot blank the
// whole response; a query- or iteration-level failure is wrapped and
// returned for the handler to surface as a 500.
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
		if err := rows.Scan(&d.ID, &d.StartDate, &d.DistanceM, &d.DurationS, &d.SpeedAvgMps,
			&d.PowerAvgW, &d.PowerMinW, &d.StartSocPct, &d.EndSocPct, &d.Efficiency); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("regen: scan drive row")
			continue
		}
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
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("regen: scan monthly row")
			continue
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate monthly regen rows: %w", err)
	}
	return out, nil
}

// LifetimeEnergy sums lifetime regen/drive energy (watt-hours) from
// cagg_fleet_stats, optionally scoped to [start, end]. A missing row
// (pgx.ErrNoRows) is treated as zero totals, not an error, because the
// aggregate is meaningful for a vehicle with no recorded days.
func (r *regenRepo) LifetimeEnergy(ctx context.Context, vehicleID int64, hasRange bool, start, end time.Time) (float64, float64, error) {
	var regenWh, driveWh float64
	err := r.db.Pool.QueryRow(ctx, lifetimeEnergySQL,
		vehicleID,
		apiparams.NullableTime(hasRange, start), apiparams.NullableTime(hasRange, end),
	).Scan(&regenWh, &driveWh)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, 0, fmt.Errorf("query lifetime regen energy: %w", err)
	}
	return regenWh, driveWh, nil
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
