package weeklydigest

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// weeklyPool is the minimal pgx surface dbWeeklyRepo needs. Declaring it
// as an interface (rather than binding directly to *pgxpool.Pool) lets the
// repo scan logic be unit-tested with an in-package fake — this codebase
// does not vendor pgxmock. *pgxpool.Pool satisfies it, mirroring the
// sleepPool precedent in internal/api/sleep/repo.go.
type weeklyPool interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// weekStats holds the aggregated drive totals for a single week window,
// already converted to the legacy km / kWh wire units the frontend
// expects. The snake-case JSON tags document the wire mapping even though
// the handler serialises an explicit envelope map rather than the struct.
type weekStats struct {
	Drives     int     `json:"drives"`
	DistanceKm float64 `json:"distance_km"`
	EnergyKwh  float64 `json:"energy_kwh"`
	Cost       float64 `json:"cost"`
	Efficiency float64 `json:"efficiency"`
}

// weeklyRepository is the data surface the handler needs. Kept as an
// interface so handler tests can supply a fake without a live database,
// matching the sleepRepository precedent.
type weeklyRepository interface {
	// WeekTotals returns the raw drive count, summed distance (metres) and
	// summed energy (watt-hours) for drives whose started_at falls in the
	// half-open [start, end) window. All values are canonical SI as stored
	// on disk; unit conversion is the handler's responsibility.
	WeekTotals(ctx context.Context, vehicleID int64, start, end time.Time) (drives int, distanceM, energyWh float64, err error)
}

// weekTotalsSQL sums the SI drive columns for one [start, end) window.
// distance_m and energy_used_wh are canonical SI (migration 000185);
// energy_used_wh is nullable so it is wrapped in COALESCE before SUM, and
// the whole SUM is COALESCE-guarded so an empty window returns 0 rather
// than NULL. Exposed as a package constant so the SQL-shape test can pin
// the column list and half-open range without a live database.
const weekTotalsSQL = `
	SELECT
		COUNT(*),
		COALESCE(SUM(distance_m), 0),
		COALESCE(SUM(COALESCE(energy_used_wh, 0)), 0)
	FROM drives
	WHERE vehicle_id = $1 AND started_at >= $2 AND started_at < $3`

// dbWeeklyRepo is the production weeklyRepository backed by the pgx pool.
type dbWeeklyRepo struct {
	pool weeklyPool
}

// newDBWeeklyRepo binds the repo to the shared pool. A nil pool is a
// wiring bug (mirrors newDBSleepRepo's fail-fast precedent), not a runtime
// state, so it panics rather than deferring to a nil-deref at first query.
func newDBWeeklyRepo(db *database.DB) *dbWeeklyRepo {
	if db == nil || db.Pool == nil {
		panic("weeklydigest.newDBWeeklyRepo: db pool must not be nil")
	}
	return &dbWeeklyRepo{pool: db.Pool}
}

// WeekTotals sums drive count, distance (m) and energy (Wh) in the window.
// A scan/transport error is wrapped with context; callers surface it as a
// 500 rather than silently reporting a zero-activity week.
func (r *dbWeeklyRepo) WeekTotals(ctx context.Context, vehicleID int64, start, end time.Time) (int, float64, float64, error) {
	var drives int
	var distanceM, energyWh float64
	if err := r.pool.QueryRow(ctx, weekTotalsSQL, vehicleID, start, end).
		Scan(&drives, &distanceM, &energyWh); err != nil {
		return 0, 0, 0, fmt.Errorf("query weekly drive totals: %w", err)
	}
	return drives, distanceM, energyWh, nil
}
